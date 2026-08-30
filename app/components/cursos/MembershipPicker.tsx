"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Suspense, useRef, useState } from "react";

import PortalCheckoutCta from "@/app/components/payments/PortalCheckoutCta";
import { prefersReducedMotion } from "@/app/hooks/useReveal";
import { formatCop, formatUsd, type Plan } from "@/lib/plans";

type Props = {
  monthly: Plan | null;
  annual: Plan | null;
  isColombia: boolean;
  userCountry: string | null;
  googleEnabled: boolean;
  /** Dónde vuelve el OAuth de Google para reanudar el pago. */
  returnPath: string;
};

const priceOf = (plan: Plan, isColombia: boolean) =>
  isColombia && plan.amountCop != null
    ? formatCop(plan.amountCop)
    : formatUsd(plan.amountUsd);

const listPriceOf = (plan: Plan, isColombia: boolean) => {
  if (isColombia) {
    return plan.listAmountCop != null && plan.amountCop != null
      ? formatCop(plan.listAmountCop)
      : null;
  }
  return plan.listAmountUsd != null ? formatUsd(plan.listAmountUsd) : null;
};

/**
 * Mensual o anual, con el precio a la vista y un solo botón.
 *
 * Los dos son productos distintos en la base —la mensualidad es una
 * suscripción recurrente de verdad, la anualidad un pago único que concede
 * doce meses— pero para quien compra son el mismo acceso con dos formas de
 * pagarlo, así que se eligen aquí y no en dos tarjetas separadas.
 *
 * Empieza en anual cuando existe: es la opción que conviene a las dos partes
 * —menos coste por mes para ella, menos rotación para el negocio— y la mensual
 * está a un toque para quien prefiera no comprometerse.
 */
const MembershipPicker = ({
  monthly,
  annual,
  isColombia,
  userCountry,
  googleEnabled,
  returnPath,
}: Props) => {
  const [period, setPeriod] = useState<"monthly" | "annual">(
    annual ? "annual" : "monthly",
  );
  const priceRef = useRef<HTMLSpanElement>(null);

  /**
   * El precio cuenta hasta su valor al cambiar de periodo, en vez de saltar.
   *
   * Es el único número que decide esta página, y saltar de $35 a $350 sin
   * transición se lee como si la página se hubiera roto: el ojo no sabe si es
   * otro producto. Contando, el salto **es** la información — se ve que uno es
   * diez veces el otro.
   *
   * Se anima un objeto y no el nodo: interpolar `textContent` directamente
   * daría decimales a medias en cada frame.
   */
  useGSAP(
    () => {
      const el = priceRef.current;
      if (!el) return;

      const target =
        period === "annual" ? (annual ?? monthly) : (monthly ?? annual);
      if (!target) return;

      const to =
        isColombia && target.amountCop != null
          ? target.amountCop
          : target.amountUsd;
      const format = (n: number) =>
        isColombia && target.amountCop != null
          ? formatCop(Math.round(n))
          : formatUsd(Math.round(n));

      if (prefersReducedMotion()) {
        el.textContent = format(to);
        return;
      }

      const counter = { value: 0 };
      gsap.to(counter, {
        value: to,
        duration: 0.7,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = format(counter.value);
        },
      });
    },
    { dependencies: [period, isColombia] },
  );

  const selected = period === "annual" ? annual : monthly;
  if (!selected) return null;

  const savings =
    annual && monthly
      ? isColombia && annual.amountCop != null && monthly.amountCop != null
        ? monthly.amountCop * 12 - annual.amountCop
        : monthly.amountUsd * 12 - annual.amountUsd
      : 0;

  return (
    <div>
      {annual && monthly && (
        <div
          role="radiogroup"
          aria-label="Cómo quieres pagar"
          className="inline-flex rounded-full border border-black/12 bg-white/60 p-1"
        >
          {(
            [
              ["monthly", "Mes a mes"],
              ["annual", "Un año"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={`rounded-full px-5 py-2.5 font-[font2] text-[11px] uppercase tracking-[0.18em] transition-colors ${
                period === value
                  ? "bg-ink text-paper"
                  : "text-black/50 hover:text-black"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-6 flex flex-wrap items-baseline gap-3">
        <span
          ref={priceRef}
          className="font-[font2] text-5xl leading-none tabular-nums"
        >
          {priceOf(selected, isColombia)}
        </span>
        <span className="font-[font1] text-base text-black/50">
          {selected.unitPrice ?? "por mes"}
        </span>
        {period === "annual" && listPriceOf(selected, isColombia) && (
          <span className="font-[font1] text-base text-black/35 line-through">
            {listPriceOf(selected, isColombia)}
          </span>
        )}
      </p>

      <p className="mt-2 font-[font1] text-sm text-black/55">
        {period === "annual" ? (
          <>
            Pago único.{" "}
            {savings > 0 && (
              <>
                Ahorras{" "}
                {isColombia ? formatCop(savings) : formatUsd(savings)} frente a
                pagar mes a mes.{" "}
              </>
            )}
            No se renueva solo.
          </>
        ) : (
          <>Se renueva cada mes. La cancelas cuando quieras.</>
        )}
      </p>

      {/* La cuenta tiene que existir antes de pagar: la membresía entrega el
          portal, y sin cuenta se paga y no se entra a ninguna parte. */}
      <div className="mt-8 max-w-sm">
        <Suspense fallback={<div className="h-[60px]" aria-hidden />}>
          <PortalCheckoutCta
            key={selected.id}
            plan={selected}
            isDark={false}
            userCountry={userCountry}
            googleEnabled={googleEnabled}
            autopayReturnPath={returnPath}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default MembershipPicker;
