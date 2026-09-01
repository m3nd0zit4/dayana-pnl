import type { ReactNode } from "react";

import { formatCop, formatUsd, type Plan } from "@/lib/plans";

/**
 * La tarjeta pública de un producto. Una sola, para todo.
 *
 * Llegó a haber tres maquetaciones distintas de lo mismo —dos incrustadas en
 * la página de resultado y en la del enlace de pago, más la del catálogo de
 * cursos— y la mejor de ellas, `TierCard`, se borró con el catálogo de
 * terapias. Tres copias del mismo componente divergen: eso ya pasó en este
 * panel con los cinco botones distintos de "ver la página pública".
 *
 * Que sea una sola es además lo que hace **verdad** la vista previa del CRM:
 * Dayana no ve una imitación de la tarjeta, ve la tarjeta. Si se
 * desincronizaran, la previsualización empezaría a mentir justo cuando más se
 * confía en ella — al publicar.
 *
 * No decide nada: recibe un `Plan` ya resuelto y pinta. Quién puede comprarlo,
 * en qué moneda y con qué pasarela lo deciden `resolveRecommendation` y
 * `PlanCheckoutButtons`, cada uno en su sitio.
 */

export type PublicProductCardProps = {
  plan: Plan;
  /** Colombia ve COP; el resto, USD. */
  isColombia: boolean;
  /** El botón de pago, o lo que haga las veces. Opcional: la vista previa no lo lleva. */
  action?: ReactNode;
  /** Nota bajo el botón — reversión de riesgo, condiciones. */
  footnote?: ReactNode;
  /** `sm` para la columna estrecha del enlace de pago y de la vista previa. */
  size?: "sm" | "default";
  className?: string;
};

const priceOf = (plan: Plan, isColombia: boolean): string =>
  isColombia && plan.amountCop != null
    ? formatCop(plan.amountCop)
    : formatUsd(plan.amountUsd);

const listPriceOf = (plan: Plan, isColombia: boolean): string | null => {
  if (isColombia) {
    return plan.listAmountCop != null && plan.amountCop != null
      ? formatCop(plan.listAmountCop)
      : null;
  }
  return plan.listAmountUsd != null ? formatUsd(plan.listAmountUsd) : null;
};

const PublicProductCard = ({
  plan,
  isColombia,
  action,
  footnote,
  size = "default",
  className = "",
}: PublicProductCardProps) => {
  const compact = size === "sm";
  const listPrice = listPriceOf(plan, isColombia);

  return (
    <div
      className={`relative rounded-3xl border bg-white/70 ${
        // `highlight` es lo que marca el paquete que se quiere vender. Estaba
        // en la base de datos y en el tipo `Plan`, pero ningún componente
        // público lo leía desde que se borró `TierCard`.
        plan.highlight
          ? "border-terracotta/60 shadow-[0_20px_50px_-30px_rgba(192,101,74,0.55)]"
          : "border-black/12"
      } ${compact ? "p-6" : "p-6 sm:p-8"} ${className}`}
    >
      {plan.tag && (
        <span className="absolute -top-3 left-6 rounded-full bg-terracotta px-3 py-1 font-[font2] text-[10px] uppercase tracking-[0.18em] text-paper">
          {plan.tag}
        </span>
      )}

      {plan.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={plan.imageUrl}
          alt=""
          className="mb-6 aspect-[16/9] w-full rounded-2xl object-cover"
        />
      )}

      <h3
        className={`font-[font2] uppercase leading-tight ${
          compact ? "text-xl" : "text-2xl"
        }`}
      >
        {plan.title}
      </h3>
      <p className="mt-1.5 font-[font1] text-sm text-black/50">{plan.sessions}</p>

      <p className="mt-6 flex flex-wrap items-baseline gap-2.5">
        <span
          className={`font-[font2] leading-none ${compact ? "text-3xl" : "text-4xl"}`}
        >
          {priceOf(plan, isColombia)}
        </span>
        {plan.unitPrice && (
          <span className="font-[font1] text-base text-black/50">
            {plan.unitPrice}
          </span>
        )}
        {listPrice && (
          <span className="font-[font1] text-base text-black/35 line-through">
            {listPrice}
          </span>
        )}
      </p>

      {plan.features.length > 0 && (
        <ul className="mt-7 flex flex-col gap-2.5 border-t border-black/10 pt-6">
          {plan.features.map((feature) => (
            <li
              key={feature}
              className="flex gap-3 font-[font1] text-base leading-snug text-black/70"
            >
              <span aria-hidden className="text-terracotta">
                ·
              </span>
              {feature}
            </li>
          ))}
        </ul>
      )}

      {action}

      {footnote && (
        <p className="mt-6 border-t border-black/10 pt-5 font-[font1] text-sm leading-relaxed text-black/55">
          {footnote}
        </p>
      )}
    </div>
  );
};

export default PublicProductCard;
