import type { Metadata } from "next";
import Link from "next/link";
import {
  BRAND,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../../../lib/contact";
import CheckoutAbandonCleanup from "../../components/pago/CheckoutAbandonCleanup";
import { isCheckoutReference } from "@/lib/crm/checkout-reference";

export const metadata: Metadata = {
  title: `Pago cancelado â€” ${BRAND.name}`,
  description: "Tu pago no fue procesado. Puedes intentarlo de nuevo.",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ enrollmentId?: string }>;
};

const Page = async ({ searchParams }: PageProps) => {
  const params = await searchParams;
  const legacyEnrollmentId =
    params.enrollmentId && !isCheckoutReference(params.enrollmentId)
      ? params.enrollmentId
      : undefined;

  return (
    <main className="relative min-h-screen bg-black text-white overflow-hidden">
      <CheckoutAbandonCleanup enrollmentId={legacyEnrollmentId} />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none opacity-80"
        style={{
          background: [
            "radial-gradient(60% 40% at 15% 10%, rgba(236,227,212,0.10), transparent 60%)",
            "radial-gradient(50% 45% at 85% 90%, rgba(237,195,177,0.12), transparent 65%)",
          ].join(","),
        }}
      />

      <section className="relative px-4 lg:px-8 pt-36 lg:pt-44 pb-24 max-w-2xl mx-auto">
        <div className="font-[font2] uppercase text-xs tracking-[0.4em] text-linen/80 mb-5">
          Pago no procesado
        </div>
        <h1 className="font-[font2] uppercase text-4xl lg:text-6xl leading-[0.95] mb-8">
          Volvamos a intentarlo
        </h1>

        <p className="font-[font1] text-white/75 text-base lg:text-lg leading-relaxed mb-10">
          El pago no se completÃ³. Nada quedÃ³ registrado en tu mÃ©todo de pago.
          Puedes reintentar desde la pÃ¡gina de servicios o escribirnos por
          WhatsApp y lo hacemos contigo paso a paso.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/servicios"
            className="w-full sm:flex-1 rounded-full bg-linen text-black font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-white transition-colors text-center"
          >
            Reintentar el pago
          </Link>
          <a
            href={buildWhatsAppUrl(
              "Hola Dayana, intentÃ© hacer un pago online pero quedÃ³ cancelado. Â¿Puedes ayudarme a completarlo?"
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:flex-1 rounded-full border border-linen/30 text-white/80 font-[font2] uppercase text-xs tracking-[0.25em] py-3.5 hover:bg-linen/5 hover:text-white transition-colors text-center"
          >
            Escribir por WhatsApp
          </a>
        </div>

        <div className="mt-8 font-[font1] text-[11px] text-white/40 tracking-wide">
          o escrÃ­benos al {WHATSAPP_NUMBER}
        </div>
      </section>
    </main>
  );
};

export default Page;
