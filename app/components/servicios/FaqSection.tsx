import { FAQS } from "@/lib/content/servicios-faq";

/**
 * Las preguntas frecuentes de la terapia.
 *
 * Vivían en el catálogo `/terapias`, que se retiró. Su sitio es ahora la página
 * de resultado del cuestionario: es donde aparece el precio, y por tanto donde
 * alguien se pregunta cómo son las sesiones, qué pasa después de pagar y si
 * esto sustituye a un tratamiento psicológico. Un FAQ lejos del precio es
 * documentación; junto al precio es manejo de objeciones.
 */
const FaqSection = () => {
  return (
    <section data-nav-color="black" className="reveal border-t border-black/10 bg-[#faf7f2] text-black">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20 lg:grid lg:grid-cols-1 lg:gap-0">
        <h2 className="mb-8 font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
          Preguntas frecuentes
        </h2>
        <div className="divide-y divide-black/10 border-y border-black/10">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 font-[font1] text-lg lg:text-xl leading-snug [&::-webkit-details-marker]:hidden">
                <span>{faq.q}</span>
                <span
                  aria-hidden
                  className="font-[font2] text-2xl leading-none transition-transform duration-200 group-open:rotate-45 shrink-0"
                >
                  +
                </span>
              </summary>
              <p className="font-[font1] text-[15px] leading-relaxed text-black/70 mt-3 max-w-2xl">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
