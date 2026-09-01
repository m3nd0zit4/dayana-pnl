import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PaymentLinkCheckout from "@/app/components/pagar/PaymentLinkCheckout";
import PublicProductCard from "@/app/components/productos/PublicProductCard";
import RevealScope from "@/app/components/common/RevealScope";
import {
  markPaymentLinkOpened,
  resolvePaymentLink,
} from "@/lib/crm/payment-links";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Tu pago | ${BRAND.name}`,
  robots: { index: false, follow: false },
};

/**
 * La página de un pago acordado.
 *
 * Es deliberadamente escueta: nombre, precio, qué incluye, botón. Sin menú,
 * sin comparativa, sin las otras opciones y sin argumentos de venta. Quien
 * llega aquí ya habló con Dayana y ya decidió; todo lo que se añada a esta
 * pantalla es una oportunidad de reconsiderarlo.
 *
 * Por eso tampoco lleva el chrome de marketing (ver `app/providers.tsx`): un
 * enlace a "Terapias" en la cabecera devolvería al catálogo exactamente a la
 * persona que ya salió de él.
 */
const PagarPage = async ({
  params,
}: {
  params: Promise<{ token: string }>;
}) => {
  const { token } = await params;
  const userCountry = await getServerUserCountry().catch(() => null);
  const isColombia = userCountry === "CO";

  const link = await resolvePaymentLink(token, isColombia);
  if (!link) notFound();

  await markPaymentLinkOpened(token);

  const { plan, contact, note } = link;
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      {/* Una entrada y nada más. Quien abre un enlace de pago ya decidió:
          animar esta pantalla sólo retrasa el botón. */}
      <RevealScope className="w-full max-w-md" selector=".reveal" y={24} step={0}>
        <div className="reveal">
        <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
          {BRAND.name}
        </p>
        <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
          Hola, {contact.firstName}
        </h1>
        {note && (
          <p className="mt-3 font-[font1] text-base leading-snug text-black/60">
            {note}
          </p>
        )}

        <div className="mt-8">
          <PublicProductCard
            plan={plan}
            isColombia={isColombia}
            size="sm"
            action={
              <PaymentLinkCheckout
                plan={plan}
                userCountry={userCountry}
                token={token}
              />
            }
          />
        </div>

        <p className="mt-6 text-center font-[font1] text-xs leading-relaxed text-black/45">
          Pago seguro. Al terminar recibes la confirmación por correo y
          coordinamos tu agenda.
        </p>
        </div>
      </RevealScope>
    </main>
  );
};

export default PagarPage;
