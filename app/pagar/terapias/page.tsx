import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PaymentLinkCheckout from "@/app/components/pagar/PaymentLinkCheckout";
import PublicProductCard from "@/app/components/productos/PublicProductCard";
import RevealScope from "@/app/components/common/RevealScope";
import { getPublicPlans } from "@/lib/plans-from-db";
import { isPlanVisibleForRegion } from "@/lib/pricing/plan-visibility";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Elige tu proceso | ${BRAND.name}`,
  /**
   * Igual que las otras páginas de `/pagar`: fuera de los buscadores y fuera
   * del sitemap (`app/sitemap.ts` no la lista). No es un catálogo público al
   * que se llega navegando — es UN enlace que Dayana manda por WhatsApp
   * cuando quiere ofrecer todas las terapias de una vez en vez de una sola.
   */
  robots: { index: false, follow: false },
};

/**
 * El enlace de TODAS las terapias, a precio de catálogo.
 *
 * A diferencia de `/pagar/p/<producto>` (un solo paquete) y `/pagar/<token>`
 * (una sola persona), esta ruta no depende de ningún id: lista cada terapia
 * activa y visible en la región de quien mira, para que la persona elija la
 * suya y pague ahí mismo. Existe para el caso «ya hablamos, todavía no sabe
 * cuál paquete» — mandar un enlace por producto obligaría a preguntar primero.
 *
 * No lleva token porque no es de nadie en particular: el pago sigue el camino
 * anónimo normal, igual que `/pagar/p/<producto>`, y cada quien que pague
 * recibe su propia ficha.
 *
 * Las puertas de visibilidad son las MISMAS que las de los otros dos enlaces
 * (`getPlanFromDb` / `isPlanVisibleForRegion` vía `resolveDefaultProductLink`),
 * aplicadas aquí producto a producto: una terapia retirada o sin precio en la
 * moneda de quien mira no aparece, en vez de aparecer con un botón roto.
 */
const PagarTerapiasPage = async () => {
  const userCountry = await getServerUserCountry().catch(() => null);
  const isColombia = userCountry === "CO";

  const { therapyPlans } = await getPublicPlans();

  // `therapyPlans` ya viene en el orden del catálogo (`sortOrder` de
  // Product). Se reordena por número de sesiones —menos primero— y se
  // conserva el orden del catálogo como desempate: `Array.prototype.sort` es
  // estable, así que dos paquetes con el mismo número de sesiones (o sin él)
  // no se reordenan entre sí sin motivo.
  const visiblePlans = therapyPlans
    .filter((plan) => isPlanVisibleForRegion(plan, isColombia))
    .sort(
      (a, b) => (a.sessionsCount ?? Infinity) - (b.sessionsCount ?? Infinity)
    );

  if (visiblePlans.length === 0) notFound();

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      {/* Misma entrada única que `PagarShell`: quien abre este enlace ya
          habló con Dayana, sólo falta elegir el paquete. */}
      <RevealScope className="w-full max-w-md" selector=".reveal" y={24} step={0}>
        <div className="reveal">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {BRAND.name}
          </p>

          <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
            Elige tu proceso
          </h1>

          <p className="mt-3 font-[font1] text-base leading-snug text-black/60">
            Cada opción, al precio del catálogo. Elige la tuya y paga aquí
            mismo.
          </p>

          <div className="mt-8 flex flex-col gap-6">
            {visiblePlans.map((plan) => (
              <PublicProductCard
                key={plan.id}
                plan={plan}
                isColombia={isColombia}
                size="sm"
                action={
                  <PaymentLinkCheckout plan={plan} userCountry={userCountry} />
                }
              />
            ))}
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

export default PagarTerapiasPage;
