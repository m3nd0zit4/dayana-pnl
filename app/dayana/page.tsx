import type { Metadata } from "next";
import Link from "next/link";

import Footer from "../components/home/Footer";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import JsonLd from "../components/seo/JsonLd";
import { METHOD_STEPS } from "@/lib/diagnostico/profiles";
import { BRAND } from "@/lib/contact";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";

const title = `Quién es Dayana | ${BRAND.name}`;
const description =
  "Maestra en Programación Neurolingüística. Cómo trabaja, por qué la PNL con base en neurociencia, y qué esperar de un proceso con ella.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/dayana" },
  openGraph: { title, description, url: "/dayana", type: "profile" },
};

/**
 * La página que faltaba.
 *
 * El argumento de "por qué ella y no cualquier otro" sólo existía dentro de la
 * llamada de ventas. Mientras siga sin estar escrito en ninguna parte, la
 * llamada es obligatoria — y ese es justamente el cuello de botella que este
 * embudo intenta quitar.
 */
const DayanaPage = () => (
  <>
    <JsonLd
      data={buildBreadcrumbSchema([
        { name: "Inicio", url: "/" },
        { name: "Dayana", url: "/dayana" },
      ])}
    />
    <main className="bg-hero-paper text-ink">
      <section className="mx-auto grid w-full max-w-5xl gap-10 px-5 pb-16 pt-28 sm:px-8 sm:pt-36 lg:grid-cols-[1fr_0.8fr] lg:items-center">
        <div>
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            Quién te va a acompañar
          </p>
          <h1 className="mt-5 font-[font2] text-4xl uppercase leading-[0.92] sm:text-6xl">
            Dayana Beltrán
          </h1>
          <p className="mt-3 font-[font1] text-lg text-black/50">
            {BRAND.tagline}
          </p>
          <p className="mt-8 max-w-xl font-[font1] text-xl leading-snug text-black/75">
            No trabajo con consejos. Trabajo con el punto exacto donde se
            instaló el patrón, y lo desactivo contigo en vivo.
          </p>
        </div>

        <picture>
          <source
            srcSet="/dayana-photos/opt/IMG_4006-900.avif"
            type="image/avif"
          />
          <source
            srcSet="/dayana-photos/opt/IMG_4006-900.webp"
            type="image/webp"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dayana-photos/opt/IMG_4006-900.webp"
            alt="Dayana Beltrán"
            width={900}
            height={1125}
            className="w-full rounded-3xl object-cover"
          />
        </picture>
      </section>

      <section className="border-t border-black/10">
        <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
          <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
            Por qué PNL y no otra cosa
          </h2>
          <div className="mt-6 flex flex-col gap-5 font-[font1] text-lg leading-relaxed text-black/75">
            <p>
              La mayoría de los procesos de acompañamiento trabajan con la parte
              consciente: entender de dónde viene, decidir cambiarlo, sostener
              el esfuerzo. Funciona con hábitos. No funciona con patrones,
              porque un patrón no se instaló con un argumento y no se desmonta
              con otro.
            </p>
            <p>
              La programación neurolingüística va al evento donde se instaló y
              desactiva la carga emocional que lo sostiene. Cuando eso pasa, el
              recuerdo sigue ahí pero deja de disparar la reacción — y la
              conducta cambia sola, sin fuerza de voluntad de por medio. La
              neuroplasticidad es lo que explica por qué el cambio se queda.
            </p>
            <p>
              Por eso el proceso no es hablar durante meses. Es ir al punto,
              desactivarlo, e instalar la respuesta nueva.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-black/10 bg-linen/40">
        <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
          <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
            Cómo es una sesión
          </h2>
          <ol className="mt-9 flex flex-col gap-8">
            {METHOD_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-5">
                <span className="font-[font2] text-sm text-terracotta">
                  0{i + 1}
                </span>
                <div>
                  <h3 className="font-[font2] text-lg uppercase leading-tight">
                    {step.title}
                  </h3>
                  <p className="mt-2 font-[font1] text-base leading-relaxed text-black/70">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-9 font-[font1] text-base leading-relaxed text-black/60">
            Una hora, 1:1 en vivo por Google Meet, desde donde estés. No hay
            grabación de tu sesión ni terceros escuchando.
          </p>
        </div>
      </section>

      <section className="border-t border-black/10">
        <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
          <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
            Qué no es
          </h2>
          <ul className="mt-7 flex flex-col gap-4 font-[font1] text-lg leading-relaxed text-black/75">
            <li className="flex gap-3">
              <span aria-hidden className="text-terracotta">
                ·
              </span>
              No es psicología clínica ni sustituye un tratamiento
              psiquiátrico. Si estás en tratamiento, esto suma, no reemplaza.
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-terracotta">
                ·
              </span>
              No es motivación. Nadie va a decirte que le eches ganas.
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="text-terracotta">
                ·
              </span>
              No es magia ni promesa de resultado garantizado: el trabajo lo
              hacemos las dos, y tú pones la parte que nadie puede poner por ti.
            </li>
          </ul>
        </div>
      </section>

      <section className="border-t border-black/10 bg-linen/40">
        <div className="mx-auto w-full max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-20">
          <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
            ¿Empezamos por saber qué te está frenando?
          </h2>
          <p className="mx-auto mt-5 max-w-lg font-[font1] text-lg leading-relaxed text-black/70">
            Ocho preguntas, dos minutos. Al final tienes tu perfil y el camino
            que te corresponde.
          </p>
          <Link
            href="/terapias/empezar?ref=dayana"
            className="mt-9 inline-block rounded-full bg-ink px-9 py-4 font-[font2] text-xs uppercase tracking-[0.18em] text-paper"
          >
            Hacer mi diagnóstico
          </Link>
          <p className="mt-6">
            <Link
              href="/historias"
              className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/45 underline underline-offset-4 transition-colors hover:text-black"
            >
              Ver historias reales
            </Link>
          </p>
        </div>
      </section>
    </main>
    <Footer />
    <FloatingWhatsApp />
  </>
);

export default DayanaPage;
