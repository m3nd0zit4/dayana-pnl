import Link from "next/link";

/**
 * El primer bloque después del hero, y el que cambia lo que la home es.
 *
 * Antes, lo primero que se podía hacer en esta página era rellenar un
 * formulario de contacto — es decir, la única conversión disponible costaba
 * una conversación de Dayana. Aquí la persona se reconoce primero y entra al
 * diagnóstico, que cualifica solo.
 *
 * Las viñetas están escritas en primera persona a propósito: se leen como algo
 * que la visitante ya se ha dicho, no como una descripción de servicios.
 */

const MIRROR = [
  "Sabes exactamente qué te pasa y sigues haciendo lo mismo.",
  "Ya lo intentaste: entendiste, decidiste, y a la semana volviste.",
  "Por fuera funcionas. Por dentro llevas años cansada.",
  "Cambian las personas y las situaciones, y la historia se repite igual.",
];

const DiagnosticInvite = () => (
  <section
    id="reconoces"
    data-nav-color="black"
    className="relative z-10 scroll-mt-20 rounded-t-[1.75rem] bg-[#f7f3ec] text-black shadow-[0_-34px_80px_-24px_rgba(0,0,0,0.5)] lg:rounded-t-[3.5rem]"
  >
    <div className="px-5 py-24 lg:px-12 lg:py-32 xl:px-20">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-terracotta">
          Antes de nada
        </p>
        <h2 className="mt-6 font-[font2] text-[13vw] uppercase leading-[0.88] sm:text-[10vw] lg:text-[6.5vw]">
          ¿Te reconoces?
        </h2>

        <div className="mt-12 grid grid-cols-1 gap-12 lg:mt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
          <ul className="flex flex-col gap-6 border-t border-black/10 pt-8">
            {MIRROR.map((line) => (
              <li
                key={line}
                className="flex gap-4 font-[font1] text-lg leading-snug text-black/75 lg:text-2xl"
              >
                <span aria-hidden className="text-terracotta">
                  ·
                </span>
                {line}
              </li>
            ))}
          </ul>

          <div className="lg:border-l lg:border-black/10 lg:pl-16">
            <p className="font-[font1] text-lg leading-snug text-black/70 lg:text-xl">
              Eso no es carácter ni falta de disciplina: es un patrón instalado,
              y los patrones se pueden desinstalar. El primer paso es saber cuál
              es el tuyo.
            </p>
            <Link
              href="/diagnostico?ref=home"
              className="mt-10 inline-flex items-center gap-3 rounded-full bg-black px-8 py-4 font-[font2] text-sm uppercase tracking-[0.15em] text-linen transition-all duration-300 hover:-translate-y-0.5 hover:bg-terracotta hover:text-white"
            >
              Haz tu diagnóstico gratis
              <span aria-hidden>→</span>
            </Link>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.3em] text-black/40">
              8 preguntas · 2 minutos · sin costo
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default DiagnosticInvite;
