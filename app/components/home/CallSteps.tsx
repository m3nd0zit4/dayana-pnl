import Link from "next/link";

/**
 * «Cómo funciona» — la franja que sigue a la portada.
 *
 * Toda la página de inicio es ahora un camino a una sola acción: agendar la
 * llamada gratis en `/llamada`. Esta franja dice en tres pasos qué va a pasar
 * al tocar el botón, que es lo único que alguien que llega desde un reel
 * necesita saber antes de dejar su número.
 *
 * Solo dice hechos del contrato (`docs/embudo-llamada.md`): es gratis, la
 * agenda la propia persona en el calendario de Dayana y Dayana llama por
 * WhatsApp. La duración NO se escribe aquí: viene de la API y la muestra
 * `/llamada`.
 *
 * Es un componente de servidor y no lleva animación a propósito. Ocupa el
 * sitio que tenía el formulario de contacto justo debajo de la portada, y por
 * eso hereda su carcasa (esquinas redondeadas + sombra sobre el negro de la
 * portada): es lo que hace de relevo cuando termina la escena fijada del hero.
 * Sin `gsap.from`, el botón existe desde el primer render, también para quien
 * no hace scroll o no carga el JavaScript.
 */

const STEPS = [
  {
    n: "01",
    title: "Dejas tus datos",
    body: "Tu nombre y tu WhatsApp.",
  },
  {
    n: "02",
    title: "Eliges la hora",
    body: "Ves las horas libres de la agenda de Dayana, en tu zona horaria.",
  },
  {
    n: "03",
    title: "Dayana te llama por WhatsApp",
    body: "A la hora que elegiste. Sin enlaces de videollamada.",
  },
] as const;

const CallSteps = () => (
  <section
    id="como-funciona"
    data-nav-color="black"
    aria-labelledby="como-funciona-titulo"
    className="relative z-10 scroll-mt-20 rounded-t-[1.75rem] bg-hero-paper text-ink shadow-[0_-34px_80px_-24px_rgba(0,0,0,0.5)] lg:rounded-t-[3.5rem]"
  >
    <div className="px-5 py-20 lg:px-12 lg:py-28 xl:px-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            Llamada gratis
          </p>
          <h2
            id="como-funciona-titulo"
            className="mt-5 font-[font2] text-5xl uppercase leading-[0.9] sm:text-6xl lg:text-7xl"
          >
            Cómo
            <br />
            funciona
          </h2>
          <p className="mt-6 max-w-md font-[font1] text-lg leading-snug text-black/70 lg:text-xl">
            Una llamada corta con Dayana, sin costo. La agendas tú, en su
            calendario.
          </p>
          <Link
            href="/llamada?ref=inicio-pasos"
            className="mt-9 inline-flex max-w-full items-center justify-center gap-3 rounded-full bg-terracotta px-6 py-4 font-[font2] text-[11px] uppercase tracking-[0.16em] text-white transition-colors duration-300 hover:bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-hero-paper sm:px-8 sm:text-xs sm:tracking-[0.2em]"
          >
            Agenda tu llamada gratis
            <span aria-hidden="true">→</span>
          </Link>
        </div>

        <ol className="flex flex-col border-t border-black/10 lg:border-t-0 lg:pt-2">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="flex items-baseline gap-5 border-b border-black/10 py-7 lg:gap-8 lg:first:pt-0"
            >
              <span className="font-[font2] text-sm tracking-[0.2em] text-terracotta">
                {step.n}
              </span>
              <div>
                <h3 className="font-[font2] text-xl uppercase leading-tight tracking-wide lg:text-2xl">
                  {step.title}
                </h3>
                <p className="mt-2 font-[font1] text-base leading-snug text-black/65">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  </section>
);

export default CallSteps;
