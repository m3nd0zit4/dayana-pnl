import Image from "next/image";

/**
 * Medios de pago locales bajo el botón «Pagar», solo para Colombia: quien ve
 * Nequi, Bancolombia o PSE sabe antes de hacer clic que no necesita tarjeta.
 * Mercado Pago los ofrece todos en su checkout. Fuera de Colombia el cobro va
 * por PayPal y estas marcas no aplican, así que quien llama decide por país.
 *
 * Cada logo va en una píldora blanca: Nequi y Bancolombia son oscuros y se
 * perderían sobre las tarjetas de fondo negro.
 */
const METHODS = [
  { src: "/logos/pagos-colombia/pse.svg", alt: "PSE", width: 40, height: 40, className: "h-6 w-6" },
  { src: "/logos/pagos-colombia/nequi.svg", alt: "Nequi", width: 104, height: 33, className: "h-4 w-auto" },
  {
    src: "/logos/pagos-colombia/bancolombia.svg",
    alt: "Bancolombia",
    width: 100,
    height: 14,
    className: "h-3 w-auto",
  },
] as const;

const ColombiaPaymentMethods = ({
  isDark = false,
  className = "",
}: {
  isDark?: boolean;
  className?: string;
}) => (
  <div className={`flex flex-col items-center gap-1.5 ${className}`}>
    <span
      className={`font-[font1] text-[10px] uppercase tracking-[0.22em] ${
        isDark ? "text-white/55" : "text-black/45"
      }`}
    >
      Paga también con
    </span>
    <ul className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Medios de pago en Colombia">
      {METHODS.map((m) => (
        <li
          key={m.alt}
          className={`flex h-8 items-center justify-center rounded-full bg-white px-3 ${
            isDark ? "" : "border border-black/10"
          }`}
        >
          <Image
            src={m.src}
            alt={m.alt}
            width={m.width}
            height={m.height}
            unoptimized
            className={m.className}
          />
        </li>
      ))}
    </ul>
  </div>
);

export default ColombiaPaymentMethods;
