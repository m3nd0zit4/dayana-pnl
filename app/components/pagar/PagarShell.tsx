import type { ReactNode } from "react";

import PublicProductCard from "@/app/components/productos/PublicProductCard";
import RevealScope from "@/app/components/common/RevealScope";
import { BRAND } from "@/lib/contact";
import type { Plan } from "@/lib/plans";

/**
 * La pantalla de un pago, compartida por las dos formas de llegar a ella.
 *
 * Hay dos:
 *
 * - `/pagar/<token>` — el enlace que se le manda a UNA persona. Lleva su
 *   nombre y cuelga el cobro de su ficha.
 * - `/pagar/p/<producto>` — el enlace fijo del paquete, que se copia una vez y
 *   sirve para cualquiera.
 *
 * La maqueta vivía dentro de la primera. Sacarla aquí antes de escribir la
 * segunda es lo que evita que dentro de un mes haya dos páginas de pago que se
 * parecen y que ya no dicen lo mismo — el fallo que este proyecto ya pagó con
 * tres maquetaciones distintas de la tarjeta de producto.
 *
 * Es deliberadamente escueta: nombre, precio, qué incluye, botón. Sin menú, sin
 * comparativa, sin las otras opciones y sin argumentos de venta. Quien llega
 * aquí ya decidió; todo lo que se añada es una oportunidad de reconsiderarlo.
 * Por eso tampoco lleva el chrome de marketing (ver `app/providers.tsx`).
 */

type Props = {
  plan: Plan;
  isColombia: boolean;
  /**
   * Nombre de pila para el saludo, si se sabe de quién es el enlace.
   *
   * `null` es el caso normal del enlace del paquete: entonces el titular es
   * «Tu pago». Un enlace abierto no puede inventarse un nombre, y «Hola, ,» se
   * lee como una página rota.
   */
  greetingName?: string | null;
  /** Nota bajo el titular. La escribe Dayana al crear un enlace personal. */
  note?: string | null;
  /** Los botones de pago. */
  action: ReactNode;
};

const PagarShell = ({
  plan,
  isColombia,
  greetingName = null,
  note = null,
  action,
}: Props) => (
  <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
    {/* Una entrada y nada más. Quien abre un enlace de pago ya decidió:
        animar esta pantalla sólo retrasa el botón. */}
    <RevealScope className="w-full max-w-md" selector=".reveal" y={24} step={0}>
      <div className="reveal">
        <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
          {BRAND.name}
        </p>

        <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
          {greetingName ? `Hola, ${greetingName}` : "Tu pago"}
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
            action={action}
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

export default PagarShell;
