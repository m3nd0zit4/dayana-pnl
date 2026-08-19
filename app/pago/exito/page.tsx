import type { Metadata } from "next";
import Link from "next/link";
import {
  BRAND,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../../../lib/contact";
import { ProductKind } from "@prisma/client";
import { formatCop, formatUsd, isPlanId, type PlanId } from "../../../lib/plans";
import { minorToMajor } from "@/lib/crm/money";
import { getPlanFromDb } from "@/lib/plans-from-db";
import { getEnrollmentById } from "../../../lib/crm/enrollments";
import { getMemberByContactId } from "@/lib/crm/member-accounts";
import { isPlaceholderContactPhone } from "../../../lib/crm/checkout-placeholder";
import {
  isCheckoutReference,
  parseCheckoutReference,
} from "../../../lib/crm/checkout-reference";
import { findEnrollmentForCheckout } from "../../../lib/crm/checkout-fulfillment";
import { syncMercadoPagoPayment } from "../../../lib/crm/mercadopago-payments";
import { syncStripeCheckoutSession } from "../../../lib/crm/stripe-payments";
import PostPaymentLeadForm from "../../components/pago/PostPaymentLeadForm";
import CheckoutAbandonCleanup from "../../components/pago/CheckoutAbandonCleanup";
import PurchaseConversionTracking from "../../components/pago/PurchaseConversionTracking";
import { purchaseEventId } from "@/lib/meta/capi";

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
  /** Stripe Checkout return (`success_url` carries {CHECKOUT_SESSION_ID}). */
  session_id?: string;
  /** Lemon Squeezy return — `ls=1` + la referencia del checkout. */
  ls?: string;
  ref?: string;
  /** Retorno de PayPal por redirección (/api/paypal/return). */
  paypal?: string;
  plan?: string;
};

type Resolved = {
  status: "succeeded" | "processing" | "pending" | "failed" | "unknown";
  planId?: PlanId;
  refLabel?: string;
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

  // Lemon Squeezy vuelve sin id de orden: sólo con la referencia del checkout.
  // El estado real lo resuelve el lookup de matrícula más abajo.
  if (params.ls === "1" && params.ref) {
    const checkout = parseCheckoutReference(params.ref);
    return {
      status: "processing",
      planId:
        checkout && isPlanId(checkout.planId) ? checkout.planId : undefined,
    };
  }

  // PayPal por redirección: `/api/paypal/return` ya capturó el pago y manda
  // aquí con el enrollmentId. Sin esta rama caía en "unknown" y la página
  // decía "no pudimos recuperar el detalle" sobre un cobro que SÍ se hizo.
  if (params.enrollmentId && !isCheckoutReference(params.enrollmentId)) {
    return { status: "succeeded", refLabel: params.enrollmentId };
  }

  // Captura no concluyente en el retorno de PayPal: el webhook firmado es la
  // fuente de verdad y puede llegar en segundos, así que "en proceso", nunca
  // "falló".
  if (params.paypal === "1") {
    return { status: "processing" };
  }

  // Stripe: the real status comes from reconciling the session server-side
  // (see below); this only seeds the plan and the reference label.
  if (params.session_id) {
    return {
      status: "processing",
      refLabel: params.session_id,
      planId: params.plan && isPlanId(params.plan) ? params.plan : undefined,
    };
  }

  return { status: "unknown" };
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

const Page = async ({ searchParams }: PageProps) => {
  const params = await searchParams;
  let result = resolveReturn(params);

  // Stripe Checkout returns here with `session_id`. Same reasoning as the
  // Mercado Pago reconciliation further down: registration must not depend
  // solely on the webhook arriving. `syncStripeCheckoutSession` is idempotent
  // per PaymentIntent, so a webhook that already fired (or fires later) is a
  // no-op, and it is the API — not the query string — that decides the status.
  let stripeEnrollmentId: string | undefined;
  if (params.session_id) {
    const sync = await syncStripeCheckoutSession(params.session_id).catch(
      (e) => {
        console.error("[pago/exito] stripe reconciliation failed", e);
        return null;
      }
    );
    if (sync?.outcome === "recorded") {
      stripeEnrollmentId = sync.enrollmentId;
      result = { ...result, status: "succeeded" };
    }
    // Anything else stays "processing": a delayed payment method, or a
    // subscription whose first `invoice.paid` has not landed yet.
  }

  // Lemon Squeezy: el webhook firmado es la única fuente de verdad, así que
  // aquí sólo se comprueba si YA llegó. `ref` no es frontera de confianza —
  // sólo lee una matrícula que el webhook verificado creó, nunca la concede.
  let lemonSqueezyEnrollmentId: string | undefined;
  if (params.ls === "1" && params.ref) {
    const checkout = parseCheckoutReference(params.ref);
    if (checkout) {
      lemonSqueezyEnrollmentId =
        (await findEnrollmentForCheckout(
          checkout.contactId,
          checkout.planId
        ).catch(() => null)) ?? undefined;
      if (lemonSqueezyEnrollmentId) {
        result = { ...result, status: "succeeded" };
      }
      // Si aún no está, queda "processing": el webhook viene en camino.
    }
  }

  const plan =
    result.planId != null ? await getPlanFromDb(result.planId) : null;
  const planTitle = plan?.title;
  const planSessions = plan?.sessions;
  // The actual charged amount/currency — never the plan's static USD sticker
  // price, since COP checkouts (Mercado Pago) charge in COP, not USD. This
  // fallback only applies until the real enrollment/payment resolves below
  // (or stays as-is for unknown/legacy return links with no enrollment).
  let amountLabel = plan ? formatUsd(plan.amountUsd) : undefined;
  let amountValue = plan?.amountUsd;
  let paymentCurrency: "USD" | "COP" | undefined = plan ? "USD" : undefined;
  // Mismo string que calcula el step de Inngest para la Conversions API: es lo
  // que hace que Meta cuente UNA compra y no dos. Se deriva del id del pago,
  // así que ambos lados llegan al mismo valor sin coordinarse.
  let purchaseEventIdValue: string | undefined;

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
        : "Estado del pago";

  const eyebrow = isSuccess
    ? "Gracias por tu confianza"
    : isProcessing
      ? "Un momento"
      : isFailed
        ? "Algo ocurrió"
        : "Referencia";

  // Mercado Pago returns here with `payment_id` on approved checkouts.
  // Registration must not depend solely on the webhook arriving (a
  // misconfigured or missing dashboard webhook silently drops it) — reconcile
  // synchronously so the Payment/Enrollment rows exist before the lookups
  // below run. Safe to repeat: recordPayment/fulfillCheckoutPayment are
  // idempotent per provider+providerPaymentId, so a webhook that fires later
  // (or already fired) is a no-op.
  if (isSuccess && params.payment_id) {
    await syncMercadoPagoPayment(params.payment_id).catch((e) => {
      console.error("[pago/exito] mercadopago reconciliation failed", e);
    });
  }

  let enrollmentId =
    stripeEnrollmentId ??
    lemonSqueezyEnrollmentId ??
    (params.enrollmentId && !isCheckoutReference(params.enrollmentId)
      ? params.enrollmentId
      : undefined);

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
  let coursePortal: "invite" | "account" | null = null;
  let portalKind: "COURSE" | "WORKSHOP" | null = null;
  if (isSuccess && enrollmentId) {
    try {
      const enrollment = await getEnrollmentById(enrollmentId);
      if (enrollment) {
        if (isPlaceholderContactPhone(enrollment.contact.phoneE164)) {
          postPaymentMode = "legacy";
        } else if (!enrollment.contact.email) {
          postPaymentMode = "email-only";
        }

        if (
          enrollment.product.kind === ProductKind.COURSE ||
          enrollment.product.kind === ProductKind.WORKSHOP
        ) {
          const member = await getMemberByContactId(enrollment.contactId);
          const hasAccess =
            member?.account?.passwordHash || member?.account?.googleSub;
          coursePortal = hasAccess ? "account" : "invite";
          portalKind = enrollment.product.kind;
        }

        const paid = enrollment.payments.find((p) => p.status === "APPROVED");
        if (paid) {
          paymentCurrency = paid.currency === "COP" ? "COP" : "USD";
          const major = minorToMajor(paid.amountMinor, paid.currency);
          amountValue = major;
          purchaseEventIdValue = purchaseEventId(paid.id);
          amountLabel =
            paymentCurrency === "COP" ? formatCop(major) : formatUsd(major);
        }
      }
    } catch {
      postPaymentMode = "none";
    }
  }

  const whatsappMessage = isSuccess
    ? `Hola Dayana, acabo de completar mi pago${
        amountLabel ? ` por ${amountLabel} ${paymentCurrency ?? "USD"}` : ""
      }${
        planTitle ? ` del plan ${planTitle}` : ""
      }. Quiero agendar mi primera sesión.`
    : `Hola Dayana, tuve un problema con el pago online${
        planTitle ? ` del plan ${planTitle}` : ""
      }. ¿Puedes ayudarme a completarlo?`;

  const planId =
    extRef && isCheckoutReference(extRef)
      ? parseCheckoutReference(extRef)?.planId
      : extRef && isPlanId(extRef)
        ? extRef
        : params.plan && isPlanId(params.plan)
          ? params.plan
          : undefined;

  return (
    <main data-nav-color="dark" className="relative min-h-screen bg-linen text-[#141118] overflow-hidden">
      {failedEnrollmentId ? (
        <CheckoutAbandonCleanup enrollmentId={failedEnrollmentId} />
      ) : null}
      {isSuccess ? (
        <PurchaseConversionTracking
          refLabel={result.refLabel}
          value={amountValue}
          currency={paymentCurrency}
          planId={planId}
          eventId={purchaseEventIdValue}
        />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-80"
        style={{
          background: [
            "radial-gradient(60% 40% at 15% 10%, rgba(237,195,177,0.30), transparent 60%)",
            "radial-gradient(50% 45% at 85% 90%, rgba(20,17,24,0.06), transparent 65%)",
          ].join(","),
        }}
      />

      <section className="relative px-4 lg:px-8 pt-36 lg:pt-44 pb-24 max-w-2xl mx-auto">
        <div className="font-[font2] uppercase text-xs tracking-[0.4em] text-black/55 mb-5">
          {eyebrow}
        </div>
        <h1 className="font-[font2] uppercase text-4xl lg:text-6xl leading-[0.95] mb-8">
          {heading}
        </h1>

        {isSuccess && (
          <div className="rounded-2xl border border-black/10 bg-white p-6 mb-10 shadow-[0_10px_30px_rgba(20,17,24,0.06)]">
            <div className="flex items-center gap-4">
              <div className="relative w-12 h-12 shrink-0">
                <div className="absolute inset-0 rounded-full bg-[#141118]/[0.07]" />
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
                  <div className="font-[font2] uppercase text-xs tracking-[0.3em] text-black/55">
                    {planTitle}
                    {planSessions ? ` · ${planSessions}` : ""}
                  </div>
                )}
                {amountLabel && (
                  <div className="font-[font1] text-3xl mt-1 leading-none">
                    {amountLabel}{" "}
                    <span className="font-[font2] uppercase text-xs tracking-[0.3em] text-black/50">
                      {paymentCurrency ?? "USD"}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {result.refLabel && (
              <div className="font-[font1] text-[11px] text-black/45 mt-4 break-all">
                Ref: {result.refLabel}
              </div>
            )}
          </div>
        )}

        {isProcessing && (
          <p className="font-[font1] text-black/70 text-base lg:text-lg leading-relaxed mb-10">
            Tu medio de pago puede tardar unos minutos en confirmarse. Te
            escribiremos por WhatsApp apenas quede listo. No necesitas volver a
            pagar.
          </p>
        )}

        {isFailed && (
          <p className="font-[font1] text-black/70 text-base lg:text-lg leading-relaxed mb-10">
            El pago no se completó. Puedes intentarlo de nuevo desde la sección
            de servicios o escribirnos por WhatsApp para ayudarte.
          </p>
        )}

        {result.status === "unknown" && (
          <p className="font-[font1] text-black/70 text-base lg:text-lg leading-relaxed mb-10">
            No pudimos recuperar el detalle de tu pago. Si completaste la
            operación, escríbenos por WhatsApp y lo verificamos contigo.
          </p>
        )}

        {isSuccess && postPaymentMode === "none" && (
          <p className="font-[font1] text-black/75 text-base lg:text-lg leading-relaxed mb-6">
            Tu pago quedó vinculado a tu contacto. Agenda tu primera sesión por
            WhatsApp cuando quieras.
          </p>
        )}

        {isSuccess && postPaymentMode === "legacy" && (
          <p className="font-[font1] text-black/75 text-base lg:text-lg leading-relaxed mb-6">
            Para vincular este pago en nuestro sistema, confirma tu teléfono a
            continuación.
          </p>
        )}

        {isSuccess && postPaymentMode === "email-only" && (
          <p className="font-[font1] text-black/75 text-base lg:text-lg leading-relaxed mb-6">
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

        {isSuccess && coursePortal && (
          <div className="rounded-2xl border border-blush/45 bg-blush/[0.14] p-6 mb-10">
            <div className="font-[font2] uppercase text-xs tracking-[0.3em] text-[#a2543a] mb-3">
              Portal de miembros
            </div>
            {coursePortal === "invite" ? (
              <>
                <p className="font-[font1] text-black/75 text-sm lg:text-base leading-relaxed mb-5">
                  {portalKind === "WORKSHOP"
                    ? "Te enviamos un correo para crear tu cuenta del portal de miembros: con ella podrás volver a entrar a la página completa de tu taller cuando quieras."
                    : "Te enviamos un correo para crear tu cuenta del portal de miembros: ahí encontrarás el enlace de las clases en vivo, las grabaciones y los módulos del curso."}
                </p>
                <Link
                  href="/miembros/crear-cuenta"
                  className="inline-block rounded-full bg-[#141118] text-linen font-[font2] uppercase text-xs tracking-[0.25em] px-8 py-3.5 hover:bg-black transition-colors"
                >
                  Crear mi cuenta
                </Link>
              </>
            ) : (
              <>
                <p className="font-[font1] text-black/75 text-sm lg:text-base leading-relaxed mb-5">
                  {portalKind === "WORKSHOP"
                    ? "Ya tienes cuenta del portal. Entra para ver la página completa de tu taller."
                    : "Tu mensualidad quedó al día. Entra al portal para ver las próximas clases, grabaciones y módulos."}
                </p>
                <Link
                  href="/miembros"
                  className="inline-block rounded-full bg-[#141118] text-linen font-[font2] uppercase text-xs tracking-[0.25em] px-8 py-3.5 hover:bg-black transition-colors"
                >
                  Entrar al portal
                </Link>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href={buildWhatsAppUrl(whatsappMessage)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:flex-1 rounded-full bg-[#141118] text-linen font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-black transition-colors text-center"
          >
            {isSuccess ? "Agendar por WhatsApp" : "Escribir por WhatsApp"}
          </a>
          <Link
            href="/"
            className="w-full sm:flex-1 rounded-full border border-black/20 text-black/70 font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-black/[0.04] hover:text-black transition-colors text-center"
          >
            Volver al inicio
          </Link>
        </div>

        <div className="mt-8 font-[font1] text-[11px] text-black/45 tracking-wide">
          o escríbenos al {WHATSAPP_NUMBER}
        </div>
      </section>
    </main>
  );
};

export default Page;
