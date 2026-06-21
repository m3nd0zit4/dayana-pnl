import type { Metadata } from "next";
import Link from "next/link";
import {
  BRAND,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../../../lib/contact";
import { formatUsd, isPlanId, type PlanId } from "../../../lib/plans";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { getEnrollmentById } from "../../../lib/crm/enrollments";
import { isPlaceholderContactPhone } from "../../../lib/crm/checkout-placeholder";
import {
  isCheckoutReference,
  parseCheckoutReference,
} from "../../../lib/crm/checkout-reference";
import { findEnrollmentForCheckout } from "../../../lib/crm/checkout-fulfillment";
import PostPaymentLeadForm from "../../components/pago/PostPaymentLeadForm";
import CheckoutAbandonCleanup from "../../components/pago/CheckoutAbandonCleanup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Pago confirmado — ${BRAND.name}`,
  description:
    "Tu pago fue recibido. Agenda tu primera sesión con Dayana por WhatsApp.",
  robots: { index: false, follow: false },
};

type SearchParams = {
  collection_status?: string;
  status?: string;
  external_reference?: string;
  enrollmentId?: string;
  payment_id?: string;
  merchant_order_id?: string;
  preference_id?: string;
  /** Legacy Stripe redirect */
  payment_intent?: string;
  plan?: string;
};

type Resolved = {
  status: "succeeded" | "processing" | "pending" | "failed" | "unknown";
  planId?: PlanId;
  refLabel?: string;
  legacyStripe?: boolean;
};

const resolveReturn = (params: SearchParams): Resolved => {
  const mpStatus = params.status ?? params.collection_status;
  const ext = params.external_reference;

  if (mpStatus || params.payment_id || ext) {
    let planId: PlanId | undefined;

    if (ext) {
      const checkout = parseCheckoutReference(ext);
      if (checkout && isPlanId(checkout.planId)) {
        planId = checkout.planId;
      } else if (isPlanId(ext)) {
        planId = ext;
      } else if (params.plan && isPlanId(params.plan)) {
        planId = params.plan;
      }
    } else if (params.plan && isPlanId(params.plan)) {
      planId = params.plan;
    }

    const ref =
      params.payment_id ??
      params.merchant_order_id ??
      params.preference_id;

    if (mpStatus === "approved") {
      return {
        status: "succeeded",
        planId,
        refLabel: ref ? String(ref) : undefined,
      };
    }
    if (mpStatus === "pending" || mpStatus === "in_process") {
      return {
        status: "pending",
        planId,
        refLabel: ref ? String(ref) : undefined,
      };
    }
    if (mpStatus === "rejected" || mpStatus === "failure") {
      return {
        status: "failed",
        planId,
        refLabel: ref ? String(ref) : undefined,
      };
    }
    if (params.payment_id && !mpStatus) {
      return {
        status: "succeeded",
        planId,
        refLabel: String(params.payment_id),
      };
    }
    return {
      status: "unknown",
      planId,
      refLabel: ref ? String(ref) : undefined,
    };
  }

  if (params.payment_intent) {
    return {
      status: "unknown",
      legacyStripe: true,
      planId:
        params.plan && isPlanId(params.plan) ? params.plan : undefined,
    };
  }

  return { status: "unknown" };
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: PageProps) => {
  const params = await searchParams;
  const result = resolveReturn(params);

  const plan =
    result.planId != null ? await getPlanFromDb(result.planId) : null;
  const planTitle = plan?.title;
  const planSessions = plan?.sessions;
  const amountLabel = plan ? formatUsd(plan.amountUsd) : undefined;

  const isSuccess = result.status === "succeeded";
  const isProcessing =
    result.status === "processing" || result.status === "pending";
  const isFailed = result.status === "failed";

  const failedEnrollmentId =
    isFailed && params.enrollmentId && !isCheckoutReference(params.enrollmentId)
      ? params.enrollmentId
      : isFailed &&
          params.external_reference &&
          !isPlanId(params.external_reference) &&
          !isCheckoutReference(params.external_reference)
        ? params.external_reference
        : undefined;

  const heading = isSuccess
    ? "Pago confirmado"
    : isProcessing
      ? "Pago en proceso"
      : isFailed
        ? "Pago no completado"
        : result.legacyStripe
          ? "Referencia antigua"
          : "Estado del pago";

  const eyebrow = isSuccess
    ? "Gracias por tu confianza"
    : isProcessing
      ? "Un momento"
      : isFailed
        ? "Algo ocurrió"
        : result.legacyStripe
          ? "Stripe ya no está activo"
          : "Referencia";

  const whatsappMessage = isSuccess
    ? `Hola Dayana, acabo de completar mi pago${
        amountLabel ? ` por ${amountLabel} USD` : ""
      }${
        planTitle ? ` del plan ${planTitle}` : ""
      }. Quiero agendar mi primera sesión.`
    : `Hola Dayana, tuve un problema con el pago online${
        planTitle ? ` del plan ${planTitle}` : ""
      }. ¿Puedes ayudarme a completarlo?`;

  let enrollmentId =
    params.enrollmentId &&
    !isCheckoutReference(params.enrollmentId)
      ? params.enrollmentId
      : undefined;

  const extRef = params.external_reference;
  if (!enrollmentId && extRef && !isPlanId(extRef)) {
    const checkout = parseCheckoutReference(extRef);
    if (checkout) {
      enrollmentId =
        (await findEnrollmentForCheckout(
          checkout.contactId,
          checkout.planId
        )) ?? undefined;
    } else if (!isCheckoutReference(extRef)) {
      enrollmentId = extRef;
    }
  }

  let postPaymentMode: "none" | "legacy" | "email-only" = "none";
  if (isSuccess && enrollmentId) {
    try {
      const enrollment = await getEnrollmentById(enrollmentId);
      if (enrollment) {
        if (isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
          postPaymentMode = "legacy";
        } else if (!enrollment.contact.email) {
          postPaymentMode = "email-only";
        }
      }
    } catch {
      postPaymentMode = "none";
    }
  }

  const planId =
    extRef && isCheckoutReference(extRef)
      ? parseCheckoutReference(extRef)?.planId
      : extRef && isPlanId(extRef)
        ? extRef
        : params.plan && isPlanId(params.plan)
          ? params.plan
          : undefined;

  return (
    <main className="relative min-h-screen bg-black text-white overflow-hidden">
      {failedEnrollmentId ? (
        <CheckoutAbandonCleanup enrollmentId={failedEnrollmentId} />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-80"
        style={{
          background: [
            "radial-gradient(60% 40% at 15% 10%, rgba(236,227,212,0.12), transparent 60%)",
            "radial-gradient(50% 45% at 85% 90%, rgba(237,195,177,0.16), transparent 65%)",
          ].join(","),
        }}
      />

      <section className="relative px-4 lg:px-8 pt-36 lg:pt-44 pb-24 max-w-2xl mx-auto">
        <div className="font-[font2] uppercase text-xs tracking-[0.4em] text-linen/80 mb-5">
          {eyebrow}
        </div>
        <h1 className="font-[font2] uppercase text-4xl lg:text-6xl leading-[0.95] mb-8">
          {heading}
        </h1>

        {result.legacyStripe && (
          <p className="font-[font1] text-white/75 text-base lg:text-lg leading-relaxed mb-10">
            Los pagos con tarjeta ahora pasan por Mercado Pago o PayPal. Si ya
            pagaste con Stripe y no ves la confirmación, escríbenos por
            WhatsApp con el comprobante.
          </p>
        )}

        {isSuccess && (
          <div className="rounded-2xl border border-linen/15 bg-linen/[0.04] p-6 mb-10">
            <div className="flex items-center gap-4">
              <div className="relative w-12 h-12 shrink-0">
                <div className="absolute inset-0 rounded-full bg-linen/10" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ece3d4"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-6 h-6"
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              </div>
              <div className="min-w-0">
                {planTitle && (
                  <div className="font-[font2] uppercase text-xs tracking-[0.3em] text-linen/70">
                    {planTitle}
                    {planSessions ? ` · ${planSessions}` : ""}
                  </div>
                )}
                {amountLabel && (
                  <div className="font-[font1] text-3xl mt-1 leading-none">
                    {amountLabel}{" "}
                    <span className="font-[font2] uppercase text-xs tracking-[0.3em] text-white/55">
                      USD
                    </span>
                  </div>
                )}
              </div>
            </div>
            {result.refLabel && (
              <div className="font-[font1] text-[11px] text-white/40 mt-4 break-all">
                Ref: {result.refLabel}
              </div>
            )}
          </div>
        )}

        {isProcessing && (
          <p className="font-[font1] text-white/75 text-base lg:text-lg leading-relaxed mb-10">
            Tu medio de pago puede tardar unos minutos en confirmarse. Te
            escribiremos por WhatsApp apenas quede listo. No necesitas volver a
            pagar.
          </p>
        )}

        {isFailed && (
          <p className="font-[font1] text-white/75 text-base lg:text-lg leading-relaxed mb-10">
            El pago no se completó. Puedes intentarlo de nuevo desde la sección
            de servicios o escribirnos por WhatsApp para ayudarte.
          </p>
        )}

        {!result.legacyStripe && result.status === "unknown" && (
          <p className="font-[font1] text-white/75 text-base lg:text-lg leading-relaxed mb-10">
            No pudimos recuperar el detalle de tu pago. Si completaste la
            operación, escríbenos por WhatsApp y lo verificamos contigo.
          </p>
        )}

        {isSuccess && postPaymentMode === "none" && (
          <p className="font-[font1] text-white/80 text-base lg:text-lg leading-relaxed mb-6">
            Tu pago quedó vinculado a tu contacto. Agenda tu primera sesión por
            WhatsApp cuando quieras.
          </p>
        )}

        {isSuccess && postPaymentMode === "legacy" && (
          <p className="font-[font1] text-white/80 text-base lg:text-lg leading-relaxed mb-6">
            Para vincular este pago en nuestro sistema, confirma tu teléfono a
            continuación.
          </p>
        )}

        {isSuccess && postPaymentMode === "email-only" && (
          <p className="font-[font1] text-white/80 text-base lg:text-lg leading-relaxed mb-6">
            Tu pago quedó vinculado. Si quieres, puedes dejar tu correo para
            recibir confirmaciones.
          </p>
        )}

        {isSuccess && postPaymentMode !== "none" && (
          <PostPaymentLeadForm
            enrollmentId={enrollmentId}
            planId={planId}
            mode={postPaymentMode}
          />
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href={buildWhatsAppUrl(whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:flex-1 rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-white transition-colors text-center"
          >
            {isSuccess ? "Agendar por WhatsApp" : "Escribir por WhatsApp"}
          </a>
          <Link
            href="/"
            className="w-full sm:flex-1 rounded-full border border-linen/30 text-white/80 font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-linen/5 hover:text-white transition-colors text-center"
          >
            Volver al inicio
          </Link>
        </div>

        <div className="mt-8 font-[font1] text-[11px] text-white/40 tracking-wide">
          o escríbenos al {WHATSAPP_NUMBER}
        </div>
      </section>
    </main>
  );
};

export default Page;
