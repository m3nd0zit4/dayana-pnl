type Tone = "onLight" | "onDark";

type MercadoPagoLogoProps = {
  className?: string;
  tone?: Tone;
  height?: number;
};

/**
 * Logo oficial de Mercado Pago 2025 (handshake horizontal).
 * - `onLight`: full color (azul oscuro + celeste sobre fondos claros).
 * - `onDark`: pluma blanca para fondos oscuros.
 */
export const MercadoPagoLogo = ({
  className = "",
  tone = "onLight",
  height = 28,
}: MercadoPagoLogoProps) => {
  const src =
    tone === "onDark"
      ? "/logos/mercadopago/horizontal-pluma.svg"
      : "/logos/mercadopago/horizontal-color.svg";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Mercado Pago"
      className={`block w-auto select-none ${className}`}
      style={{ height }}
      draggable={false}
    />
  );
};

type MercadoPagoBrandRowProps = {
  subtitle?: string;
  className?: string;
  tone?: Tone;
  /** Tamaño del logo (alto en px). */
  logoHeight?: number;
};

export const MercadoPagoBrandRow = ({
  className = "",
  tone = "onLight",
  logoHeight = 22,
}: MercadoPagoBrandRowProps) => {
  const sub =
    tone === "onDark"
      ? "text-linen/55 group-hover:text-linen/75"
      : "text-[#0a0080]/55 group-hover:text-[#0a0080]/80";

  return (
    <span
      className={`inline-flex flex-col items-center gap-1 text-center ${className}`}
    >
      <MercadoPagoLogo tone={tone} height={logoHeight} />
    </span>
  );
};
