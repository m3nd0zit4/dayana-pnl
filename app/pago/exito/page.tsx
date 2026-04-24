import type { Metadata } from "next";
import Link from "next/link";
import {
  BRAND,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../../../lib/contact";
import { formatUsd, getPlan, isPlanId } from "../../../lib/plans";

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
  payment_id?: string;
  merchant_order_id?: string;
  preference_id?: string;
  /** Legacy Stripe redirect */
  payment_intent?: string;
  plan?: string;
};

type Resolved = {
  status: "succeeded" | "processing" | "pending" | "failed" | "unknown";
  amountLabel?: string;
  planTitle?: string;
  planSessions?: string;
  refLabel?: string;
  legacyStripe?: boolean;
};

const resolveReturn = (params: SearchParams): Resolved => {
  const mpStatus = params.status ?? params.collection_status;
  const ext = params.external_reference;

  if (mpStatus || params.payment_id || ext) {
    let planTitle: string | undefined;
    let planSessions: string | undefined;
    let amountLabel: string | undefined;

    if (ext && isPlanId(ext)) {
      const plan = getPlan(ext);
      planTitle = plan.title;
      planSessions = plan.sessions;
      amountLabel = formatUsd(plan.amountUsd);
    } else if (params.plan && isPlanId(params.plan)) {
      const plan = getPlan(params.plan);
      planTitle = plan.title;
      planSessions = plan.sessions;
      amountLabel = formatUsd(plan.amountUsd);
    }

    const ref =
      params.payment_id ??
      params.merchant_order_id ??
      params.preference_id;

    if (mpStatus === "approved") {
      return {
        status: "succeeded",
        amountLabel,
        planTitle,
        planSessions,
        refLabel: ref ? String(ref) : undefined,
      };
    }
    if (mpStatus === "pending" || mpStatus === "in_process") {
      return {
        status: "pending",
        amountLabel,
        planTitle,
        planSessions,
        refLabel: ref ? String(ref) : undefined,
      };
    }
    if (mpStatus === "rejected" || mpStatus === "failure") {
      return {
        status: "failed",
        planTitle,
        planSessions,
        refLabel: ref ? String(ref) : undefined,
      };
    }
    if (params.payment_id && !mpStatus) {
      return {
        status: "succeeded",
        amountLabel,
        planTitle,
        planSessions,
        refLabel: String(params.payment_id),
      };
    }
    return {
      status: "unknown",
      planTitle,
      planSessions,
      refLabel: ref ? String(ref) : undefined,
    };
  }

  if (params.payment_intent) {
    return {
      status: "unknown",
      legacyStripe: true,
      planTitle:
        params.plan && isPlanId(params.plan)
          ? getPlan(params.plan).title
          : undefined,
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

  const isSuccess = result.status === "succeeded";
  const isProcessing =
    result.status === "processing" || result.status === "pending";
  const isFailed = result.status === "failed";

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
        result.amountLabel ? ` por ${result.amountLabel} USD` : ""
      }${
        result.planTitle ? ` del plan ${result.planTitle}` : ""
      }. Quiero agendar mi primera sesión.`
    : `Hola Dayana, tuve un problema con el pago online${
        result.planTitle ? ` del plan ${result.planTitle}` : ""
      }. ¿Puedes ayudarme a completarlo?`;

  return (
    <main className="relative min-h-screen bg-black text-white overflow-hidden">
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
                {result.planTitle && (
                  <div className="font-[font2] uppercase text-xs tracking-[0.3em] text-linen/70">
                    {result.planTitle}
                    {result.planSessions ? ` · ${result.planSessions}` : ""}
                  </div>
                )}
                {result.amountLabel && (
                  <div className="font-[font1] text-3xl mt-1 leading-none">
                    {result.amountLabel}{" "}
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

        {isSuccess && (
          <p className="font-[font1] text-white/80 text-base lg:text-lg leading-relaxed mb-10">
            El siguiente paso es agendar tu primera sesión con Dayana. Elige
            cuándo empezamos.
          </p>
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
