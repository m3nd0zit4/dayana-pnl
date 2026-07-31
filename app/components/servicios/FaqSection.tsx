import { FAQS } from "@/lib/content/servicios-faq";

const FaqSection = () => {
  return (
    <section data-nav-color="black" className="bg-[#faf7f2] text-black border-t border-black/10">
      <div className="px-3 lg:px-8 py-16 lg:py-24 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-12">
        <h2 className="font-[font2] text-4xl lg:text-[4.5vw] uppercase leading-[0.9] mb-10 lg:mb-0">
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
