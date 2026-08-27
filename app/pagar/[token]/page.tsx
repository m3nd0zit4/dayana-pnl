import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PaymentLinkCheckout from "@/app/components/pagar/PaymentLinkCheckout";
import {
  markPaymentLinkOpened,
  resolvePaymentLink,
} from "@/lib/crm/payment-links";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";
import { formatCop, formatUsd } from "@/lib/plans";

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
  const price =
    isColombia && plan.amountCop != null
      ? formatCop(plan.amountCop)
      : formatUsd(plan.amountUsd);

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      <div className="w-full max-w-md">
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

        <div className="mt-8 rounded-3xl border border-black/12 bg-white/70 p-6 sm:p-7">
          <h2 className="font-[font2] text-xl uppercase leading-tight">
            {plan.title}
          </h2>
          <p className="mt-1 font-[font1] text-sm text-black/50">
            {plan.sessions}
          </p>

          <p className="mt-6 flex flex-wrap items-baseline gap-2.5">
            <span className="font-[font2] text-4xl leading-none">{price}</span>
            {plan.unitPrice && (
              <span className="font-[font1] text-base text-black/50">
                {plan.unitPrice}
              </span>
            )}
          </p>

          {plan.features.length > 0 && (
            <ul className="mt-6 flex flex-col gap-2 border-t border-black/10 pt-5">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex gap-2.5 font-[font1] text-sm leading-snug text-black/65"
                >
                  <span aria-hidden className="text-terracotta">
                    ·
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          )}

          <PaymentLinkCheckout
            plan={plan}
            userCountry={userCountry}
            token={token}
          />
        </div>

        <p className="mt-6 text-center font-[font1] text-xs leading-relaxed text-black/45">
          Pago seguro. Al terminar recibes la confirmación por correo y
          coordinamos tu agenda.
        </p>
      </div>
    </main>
  );
};

export default PagarPage;
