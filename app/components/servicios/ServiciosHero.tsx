"use client";

import SplitReveal from "../ui/SplitReveal";

type Props = {
  isColombia: boolean;
};

const ServiciosHero = ({ isColombia }: Props) => {
  return (
    <section
      data-nav-color="white"
      className="bg-ink text-linen relative"
    >
      <div className="px-3 lg:px-8 pt-36 lg:pt-44 pb-16 lg:pb-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-blush mb-6">
          Servicios · Terapia PNL
        </p>
        <SplitReveal
          text={"Tu proceso,\na tu ritmo"}
          className="font-[font2] text-[15vw] lg:text-[10vw] uppercase leading-[0.85]"
        />
        <div className="lg:pl-[40%] mt-10 lg:mt-14">
          <p className="font-[font1] text-lg lg:text-3xl leading-snug text-linen/90">
            Sesiones privadas 1:1 de reprogramación neurolingüística por Google
            Meet. Elige cuántas sesiones necesitas: empieza con una o
            comprométete con tu transformación completa.
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-linen/50 mt-8">
            {isColombia
              ? "Precios en pesos colombianos · pago con MercadoPago"
              : "Precios en dólares (USD) · pago con PayPal"}
          </p>
        </div>
      </div>
    </section>
  );
};

export default ServiciosHero;
