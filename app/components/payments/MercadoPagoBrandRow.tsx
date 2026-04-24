type Tone = "onLight" | "onDark";

const iconBg = (tone: Tone) =>
  tone === "onDark" ? "bg-[#00b1ea]" : "bg-[#00a6e8]";

export const MercadoPagoWordmark = ({
  className = "",
  tone = "onLight",
}: {
  className?: string;
  tone?: Tone;
}) => (
  <span
    className={`inline-flex items-center gap-2 font-sans leading-none ${className}`}
    aria-hidden
  >
    <span
      className={`relative inline-flex h-6 w-6 items-center justify-center rounded-full ${iconBg(
        tone
      )}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4.5 w-4.5"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 13.2c2.6 0 3.1-2.7 4.9-2.7 1.7 0 2 1.5 2.6 2.2.8.8 1.3 1.1 2.2 1.1 1.4 0 2-1.1 2.8-2" />
        <path d="M8.2 9.7l1.8 1.3" />
        <path d="M15.8 9.7l-1.8 1.3" />
      </svg>
    </span>
    <span className={tone === "onDark" ? "text-[#f5fbff]" : "text-[#013b78]"}>
      mercado
    </span>
    <span className={tone === "onDark" ? "text-[#7fdcff]" : "text-[#009ee3]"}>
      pago
    </span>
  </span>
);

type MercadoPagoBrandRowProps = {
  subtitle?: string;
  className?: string;
  tone?: Tone;
};

export const MercadoPagoBrandRow = ({
  subtitle,
  className = "",
  tone = "onLight",
}: MercadoPagoBrandRowProps) => {
  const sub =
    tone === "onDark"
      ? "text-linen/55 group-hover:text-linen/75"
      : "text-black/50 group-hover:text-black/65";

  return (
    <span
      className={`inline-flex flex-col items-center gap-0.5 text-center ${className}`}
    >
      <MercadoPagoWordmark
        tone={tone}
        className="text-[16px] font-semibold tracking-[-0.01em]"
      />
      {subtitle ? (
        <span
          className={`font-[font2] text-[9px] uppercase tracking-[0.26em] ${sub}`}
        >
          {subtitle}
        </span>
      ) : null}
    </span>
  );
};
