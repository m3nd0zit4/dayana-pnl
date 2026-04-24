/**
 * Marca tipográfica Pay/Pal (paleta oficial aproximada) para CTAs y cabeceras.
 */
type Tone = "onLight" | "onDark";

export const PayPalWordmark = ({
  className = "",
  tone = "onLight",
}: {
  className?: string;
  tone?: Tone;
}) => (
  <span
    className={`inline-flex items-baseline gap-0 font-sans font-bold tracking-[-0.03em] leading-none ${className}`}
    aria-hidden
  >
    <span className={tone === "onDark" ? "text-[#e3f2ff]" : "text-[#001435]"}>
      Pay
    </span>
    <span className={tone === "onDark" ? "text-[#5ec5ff]" : "text-[#009cde]"}>
      Pal
    </span>
  </span>
);

type PayPalBrandRowProps = {
  subtitle?: string;
  className?: string;
  tone?: Tone;
};

export const PayPalBrandRow = ({
  subtitle,
  className = "",
  tone = "onLight",
}: PayPalBrandRowProps) => {
  const sub =
    tone === "onDark"
      ? "text-linen/55 group-hover:text-linen/75"
      : "text-black/50 group-hover:text-black/65";

  return (
    <span
      className={`inline-flex flex-col items-center gap-1.5 text-center ${className}`}
    >
      <PayPalWordmark tone={tone} className="text-[17px] sm:text-[18px]" />
      {subtitle ? (
        <span
          className={`font-[font2] text-[8px] uppercase tracking-[0.3em] ${sub}`}
        >
          {subtitle}
        </span>
      ) : null}
    </span>
  );
};
