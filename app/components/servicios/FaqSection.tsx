const FAQS: { q: string; a: string }[] = [
  {
    q: "¿Cómo se realizan las sesiones?",
    a: "En vivo, 1 a 1 con Dayana por Google Meet. Cada sesión dura 1 hora y la tomas desde la comodidad de tu casa.",
  },
  {
    q: "¿Cómo puedo pagar?",
    a: "Desde Colombia con MercadoPago (COP: tarjetas, PSE, Nequi). Desde otros países con PayPal (USD: saldo o tarjeta). También podemos coordinar el pago por WhatsApp.",
  },
  {
    q: "¿En qué moneda veo los precios?",
    a: "Detectamos tu país automáticamente: en Colombia verás precios en pesos (COP); fuera de Colombia, en dólares (USD).",
  },
  {
    q: "¿Puedo reprogramar una sesión?",
    a: "Sí. Cada sesión admite de 1 a 2 reprogramaciones avisando con anticipación por WhatsApp.",
  },
  {
    q: "¿Qué paquete me conviene?",
    a: "Sesión Única para conocer el proceso; Primer Paso o Transformación para trabajar un tema puntual; Evolución Profunda y Acompañamiento Total para procesos de raíz. Si dudas, escríbenos por WhatsApp y lo definimos contigo.",
  },
  {
    q: "¿Qué pasa después de pagar?",
    a: "Recibes tu confirmación y coordinamos tu agenda por WhatsApp para tu primera sesión.",
  },
];

const FaqSection = () => {
  return (
    <section className="bg-[#faf7f2] text-black border-t border-black/10">
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
