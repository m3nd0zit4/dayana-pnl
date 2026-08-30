import type { Metadata } from "next";
import Link from "next/link";

import Footer from "../components/home/Footer";
import RevealScope from "../components/common/RevealScope";
import SplitReveal from "../components/ui/SplitReveal";
import FloatingWhatsApp from "../components/ui/FloatingWhatsApp";
import JsonLd from "../components/seo/JsonLd";
import {
  TESTIMONIOS,
  youtubeThumb,
  youtubeWatchUrl,
} from "@/lib/content/testimonios";
import { BRAND } from "@/lib/contact";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";

const title = `Historias reales | ${BRAND.name}`;
const description =
  "Personas que hicieron el proceso de reprogramación neurolingüística con Dayana Beltrán, contándolo ellas mismas.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/historias" },
  openGraph: { title, description, url: "/historias", type: "website" },
};

/**
 * Los testimonios ya existían en vídeo, pero sólo dentro de una sección
 * animada de la home donde compiten con el resto de la página. Aquí tienen
 * página propia: es la que enlaza el resultado del diagnóstico cuando dice
 * "gente como tú", y la que se puede mandar por WhatsApp sin más contexto.
 */
const HistoriasPage = () => (
  <>
    <JsonLd
      data={buildBreadcrumbSchema([
        { name: "Inicio", url: "/" },
        { name: "Historias", url: "/historias" },
      ])}
    />
    <RevealScope className="bg-hero-paper text-ink" selector=".reveal" step={0.07}>
      <main>
      <section className="mx-auto w-full max-w-5xl px-5 pb-14 pt-28 sm:px-8 sm:pt-36">
        <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
          Historias reales
        </p>
        <SplitReveal
          text={`No te lo cuento yo.
Te lo cuentan ellas.`}
          className="mt-5 max-w-3xl font-[font2] text-4xl uppercase leading-[0.92] sm:text-6xl"
        />
        <p className="mt-6 max-w-xl font-[font1] text-lg leading-snug text-black/65">
          Cada una llegó por algo distinto y ninguna sabía, al empezar, que se
          podía salir de ahí. Míralas hablar.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 pb-20 sm:px-8 sm:pb-28">
        <ul className="grid gap-8 sm:grid-cols-2">
          {TESTIMONIOS.map((t) => (
            <li
              key={t.id}
              className="reveal flex flex-col overflow-hidden rounded-3xl border border-black/10 bg-white/55"
            >
              <a
                href={youtubeWatchUrl(t.youtubeId)}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block aspect-video overflow-hidden bg-black/5"
              >
                {/* Miniatura de YouTube en vez de un iframe: cuatro iframes
                    embebidos cargan el reproductor entero cuatro veces y la
                    página deja de abrir en móvil. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={youtubeThumb(t.youtubeId)}
                  alt={`Testimonio de ${t.name}`}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                <span
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-terracotta text-paper shadow-lg transition-transform duration-300 group-hover:scale-110">
                    <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              </a>

              <div className="flex flex-1 flex-col p-6 sm:p-7">
                <p className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/40">
                  Llegó por · {t.cameFrom}
                </p>
                <blockquote className="mt-4 flex-1 font-[font1] text-base leading-relaxed text-black/75">
                  “{t.excerpt}”
                </blockquote>
                <p className="mt-5 font-[font2] text-sm uppercase tracking-[0.14em]">
                  {t.name}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="reveal border-t border-black/10 bg-linen/40">
        <div className="mx-auto w-full max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-20">
          <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
            ¿Y tú por qué llegarías?
          </h2>
          <p className="mx-auto mt-5 max-w-lg font-[font1] text-lg leading-relaxed text-black/70">
            Responde ocho preguntas y sabrás qué patrón te está frenando y qué
            proceso necesitas para moverlo. Son dos minutos y no cuesta nada.
          </p>
          <Link
            href="/terapias/empezar?ref=historias"
            className="mt-9 inline-block rounded-full bg-ink px-9 py-4 font-[font2] text-xs uppercase tracking-[0.18em] text-paper"
          >
            Hacer mi diagnóstico
          </Link>
        </div>
      </section>
      </main>
    </RevealScope>
    <Footer />
    <FloatingWhatsApp />
  </>
);

export default HistoriasPage;
