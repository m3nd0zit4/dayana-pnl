import type { Metadata } from "next";
import Link from "next/link";
import {
  BRAND,
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
} from "../../../lib/contact";
import { mapMercadoPagoStatus, parsePayPalError } from "@/lib/payments/errors";

export const metadata: Metadata = {
  title: `El pago no se completó — ${BRAND.name}`,
  description: "El pago no pudo completarse. Aquí te explicamos por qué.",
  robots: { index: false, follow: false },
};

/**
 * El pago se intentó y NO salió.
 *
 * Distinta de `/pago/cancelado`, que es cuando alguien se echa atrás por su
 * cuenta: ahí no hubo error y no hay nada que explicar. Aquí sí lo hubo, y el
 * motivo es lo único que la clienta necesita para saber qué hacer.
 *
 * Existe porque un rechazo del banco acababa en `/pago/exito` diciendo «se está
 * procesando tu pago». La clienta se quedó esperando un acceso que no iba a
 * llegar, y el motivo real —su banco había rechazado la tarjeta— sólo se supo
 * llamando a PayPal.
 *
 * El código llega por la URL y se traduce con el mismo diccionario que usa el
 * backend, así que el texto no se duplica ni se puede desincronizar.
 */

type PageProps = {
  searchParams: Promise<{
    code?: string;
    provider?: string;
    /** `status_detail` de Mercado Pago, que llega con otro nombre. */
    status_detail?: string;
  }>;
};

const Page = async ({ searchParams }: PageProps) => {
  const params = await searchParams;

  const isMercadoPago =
    params.provider === "mercadopago" || Boolean(params.status_detail);

  const failure = isMercadoPago
    ? mapMercadoPagoStatus(params.status_detail ?? params.code, "rejected")
    : parsePayPalError(
        422,
        params.code ? { details: [{ issue: params.code }] } : {}
      );

  /**
   * Sin código reconocible se dice lo justo y verdadero: no se completó. Es
   * preferible a inventar un motivo — y sigue siendo mucho mejor que el
   * «procesando» de antes, que era directamente falso.
   */
  const explanation =
    failure.code === "UNKNOWN"
      ? "El pago no llegó a completarse. No se hizo ningún cargo."
      : failure.buyerMessage;

  return (
    <main
      data-nav-color="dark"
      className="relative min-h-screen overflow-hidden bg-linen text-[#141118]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background: [
            "radial-gradient(60% 40% at 15% 10%, rgba(236,227,212,0.10), transparent 60%)",
            "radial-gradient(50% 45% at 85% 90%, rgba(237,195,177,0.12), transparent 65%)",
          ].join(","),
        }}
      />

      <section className="relative mx-auto max-w-2xl px-4 pt-36 pb-24 lg:px-8 lg:pt-44">
        <div className="font-[font2] mb-5 text-xs uppercase tracking-[0.4em] text-black/55">
          El pago no se completó
        </div>
        <h1 className="font-[font2] mb-8 text-4xl uppercase leading-[0.95] lg:text-6xl">
          No se pudo cobrar
        </h1>

        <p className="font-[font1] mb-6 text-base leading-relaxed text-black/70 lg:text-lg">
          {explanation}
        </p>

        {/*
          Decirlo explícitamente evita la llamada más frecuente: «¿me cobraron?».
          Un pago rechazado no mueve dinero, pero algunos bancos dejan una
          retención visible unas horas y eso asusta.
        */}
        <p className="font-[font1] mb-10 text-sm leading-relaxed text-black/55">
          No se realizó ningún cargo. Si tu banco te muestra una retención,
          desaparece sola en unas horas.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          {failure.retryable ? (
            <Link
              href="/#servicios"
              className="font-[font2] w-full rounded-full bg-[#141118] py-3.5 text-center text-xs uppercase tracking-[0.25em] text-linen transition-colors hover:bg-black sm:flex-1"
            >
              Intentar de nuevo
            </Link>
          ) : null}
          <a
            href={buildWhatsAppUrl(
              "Hola Dayana, intenté pagar en línea y el pago fue rechazado. ¿Puedes ayudarme?"
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="font-[font2] w-full rounded-full border border-black/20 py-3.5 text-center text-xs uppercase tracking-[0.25em] text-black/70 transition-colors hover:bg-black/[0.04] hover:text-black sm:flex-1"
          >
            Escribir por WhatsApp
          </a>
        </div>

        <div className="font-[font1] mt-8 text-[11px] tracking-wide text-black/45">
          o escríbenos al {WHATSAPP_NUMBER}
        </div>
      </section>
    </main>
  );
};

export default Page;
