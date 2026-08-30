import Link from "next/link";

import { METHOD_STEPS } from "@/lib/diagnostico/profiles";

/**
 * El método y el "por qué ella".
 *
 * Este argumento sólo existía dentro de la llamada de ventas. Mientras siguiera
 * sin estar en la página, la llamada era obligatoria. Tuvo también una página
 * propia (`/dayana`) que se retiró: con el menú reducido a cuatro entradas,
 * una página entera de autoridad a la que nadie enlazaba era una ruta más que
 * mantener, no un argumento más que leer. Vive aquí y en el resultado del
 * cuestionario, que son los dos sitios donde alguien se lo está preguntando.
 */
const MethodSection = () => (
  <section
    id="metodo"
    data-nav-color="black"
    className="relative z-10 scroll-mt-20 rounded-t-[1.75rem] bg-[#ece3d4] text-black shadow-[0_-34px_80px_-24px_rgba(0,0,0,0.5)] lg:rounded-t-[3.5rem]"
  >
    <div className="px-5 py-24 lg:px-12 lg:py-32 xl:px-20">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-terracotta">
          Cómo se trabaja
        </p>
        <h2 className="mt-6 max-w-3xl font-[font2] text-[11vw] uppercase leading-[0.88] sm:text-[8vw] lg:text-[5.5vw]">
          Al punto donde se instaló
        </h2>

        <p className="mt-8 max-w-2xl font-[font1] text-lg leading-snug text-black/70 lg:text-2xl">
          Entenderlo no lo cambia: la comprensión vive en una parte del cerebro
          y el patrón en otra. Por eso el trabajo no es hablar durante meses, es
          ir al evento exacto y desactivarlo.
        </p>

        <ol className="mt-14 grid gap-10 border-t border-black/10 pt-12 lg:mt-20 lg:grid-cols-3 lg:gap-14">
          {METHOD_STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-terracotta">
                0{i + 1}
              </span>
              <h3 className="mt-4 font-[font2] text-2xl uppercase leading-tight">
                {step.title}
              </h3>
              <p className="mt-3 font-[font1] text-base leading-relaxed text-black/70">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            href="/historias"
            className="inline-flex items-center gap-3 rounded-full border border-black px-8 py-4 font-[font2] text-sm uppercase tracking-[0.15em] transition-colors duration-300 hover:bg-black hover:text-linen"
          >
            Ver historias reales
            <span aria-hidden>→</span>
          </Link>
          <Link
            href="/terapias/empezar"
            className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/50 underline underline-offset-4 transition-colors hover:text-black"
          >
            Saber qué necesito
          </Link>
        </div>
      </div>
    </div>
  </section>
);

export default MethodSection;
