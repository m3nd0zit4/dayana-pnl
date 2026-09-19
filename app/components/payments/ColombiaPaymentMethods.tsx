import Image from "next/image";

/**
 * Medios de pago locales bajo el botón «Pagar», solo para Colombia: quien ve
 * PSE, Nequi o Bancolombia sabe antes de hacer clic que no necesita tarjeta.
 * Mercado Pago los ofrece todos en su checkout. Fuera de Colombia el cobro va
 * por PayPal y estas marcas no aplican, así que quien llama decide por país.
 *
 * Solo los logos, sin texto ni marco (pedido de Dayana). PSE es el oficial de
 * pse.com.co. Nequi y Bancolombia son oscuros: sobre fondo negro se pintan en
 * blanco para que se lean.
 */
const METHODS = [
  { src: "/logos/pagos-colombia/pse.png", alt: "PSE", width: 96, height: 96, className: "h-7 w-7", mono: false },
  { src: "/logos/pagos-colombia/nequi.svg", alt: "Nequi", width: 104, height: 33, className: "h-5 w-auto", mono: true },
  {
    src: "/logos/pagos-colombia/bancolombia.svg",
    alt: "Bancolombia",
    width: 100,
    height: 14,
    className: "h-3.5 w-auto",
    mono: true,
  },
] as const;

const ColombiaPaymentMethods = ({
  isDark = false,
  className = "",
}: {
  isDark?: boolean;
  className?: string;
}) => (
  <ul
    className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 ${className}`}
    aria-label="Aceptamos PSE, Nequi y Bancolombia"
  >
    {METHODS.map((m) => (
      <li key={m.alt} className="flex items-center">
        <Image
          src={m.src}
          alt={m.alt}
          width={m.width}
          height={m.height}
          unoptimized
          className={`${m.className} ${isDark && m.mono ? "brightness-0 invert" : ""}`}
        />
      </li>
    ))}
  </ul>
);

export default ColombiaPaymentMethods;
