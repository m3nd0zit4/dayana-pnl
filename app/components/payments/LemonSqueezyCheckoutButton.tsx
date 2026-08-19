"use client";

type Props = {
  isDark: boolean;
  label?: string;
  /** Abre el modal de confirmación. Obligatorio: el desglose de comisión vive
   *  ahí, y saltárselo dejaría a la clienta viendo $80 y pagando $84.74. */
  onPay: () => void;
};

/**
 * Lemon Squeezy es checkout alojado: un POST, un redirect, y LS muestra los
 * medios de pago disponibles según el dispositivo y el país del visitante
 * (tarjeta, PayPal, Apple Pay, Google Pay…). Por eso no hay modal ni SDK.
 */
const LemonSqueezyCheckoutButton = ({
  isDark,
  label = "Pagar ahora",
  onPay,
}: Props) => {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onPay}
        className={`group flex w-full flex-col items-center justify-center gap-0.5 rounded-full border px-3 py-2.5 transition-all cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
          isDark
            ? "border-white/15 bg-white text-[#0b0a0f] shadow-[0_8px_28px_rgba(0,0,0,0.35)] hover:border-[#ffc233] hover:bg-[#fffaf0]"
            : "border-[#f3ddab] bg-gradient-to-b from-white via-[#fffdf6] to-[#fdf3dc] text-[#0b0a0f] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(180,140,20,0.10)] hover:border-[#ffc233] hover:shadow-[0_10px_28px_rgba(180,140,20,0.16)]"
        }`}
      >
        <span className="font-[font1] text-[13px] uppercase tracking-[0.18em]">
          {label}
        </span>
        <span className="font-[font1] text-[10px] uppercase tracking-[0.22em] opacity-60">
          Tarjeta · PayPal · Apple Pay · Google Pay
        </span>
      </button>
    </div>
  );
};

export default LemonSqueezyCheckoutButton;
