import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, CalendarHeart, MessageCircle } from "lucide-react";

import CallFunnel from "@/app/components/llamada/CallFunnel";
import MediaSlot from "@/app/components/llamada/MediaSlot";
import ReturningLink from "@/app/components/llamada/ReturningLink";
import type { SlotPickerSeed } from "@/app/components/llamada/SlotPicker";
import { funnelCard, primaryBtn } from "@/app/components/llamada/styles";
import { BRAND, buildWhatsAppUrl } from "@/lib/contact";
import {
  COMMUNITY_PHOTO,
  DAYANA_PHOTO,
  FEATURED_STORY,
  MAIN_VIDEO,
  VIDEO_TESTIMONIALS,
  type MediaSlot as Slot,
  type VideoTestimonial,
} from "@/lib/content/llamada-landing";
import { TESTIMONIOS } from "@/lib/content/testimonios";
import { getCallFunnelConfig } from "@/lib/crm/call-funnel/config";
import { funnelSlots } from "@/lib/crm/call-funnel/server";
import { formatWebinarScheduleLabel, getOpenFreeEvent } from "@/lib/crm/free-webinar";
import { getServerUserCountry } from "@/lib/geo/user-country";

const title = `Sesión 1 a 1 gratis con ${BRAND.name}`;
const description =
  "De sentirte sin energía a construir la vida y el negocio que te dé propósito. Agenda una llamada 1 a 1 gratis con Dayana Beltrán: ella te llama por WhatsApp.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/llamada" },
  openGraph: {
    type: "website",
    locale: "es_ES",
    url: "/llamada",
    siteName: BRAND.shortName,
    title,
    description,
    images: [{ url: "/og-image.png", width: 1083, height: 568, alt: `${BRAND.name}, ${BRAND.tagline}` }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
};

// Lee el país de quien visita, los ajustes del embudo y el evento abierto en cada pedido.
export const dynamic = "force-dynamic";

const WHATSAPP_MESSAGE = "Hola, quiero agendar mi llamada gratis con Dayana.";

/**
 * En producción, un espacio sin archivo no se muestra (ni su sección, si queda
 * vacía): un recuadro de «video pendiente» no puede verlo quien llega de un
 * anuncio. En local y en las vistas previas sí, para saber qué falta.
 */
const SHOW_PENDING = process.env.VERCEL_ENV !== "production";
const visible = (slot: Slot) => Boolean(slot.src) || SHOW_PENDING;

/** Cuánto se espera por el calendario antes de seguir sin las horas (el selector las pide él mismo). */
const HOURS_TIMEOUT_MS = 2500;

const loadHours = async (): Promise<SlotPickerSeed | null> => {
  try {
    const result = await Promise.race([
      funnelSlots(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), HOURS_TIMEOUT_MS)),
    ]);
    if (!result || result.state !== "ok") return null;
    return { slots: result.slots.map((s) => ({ startIso: s.startIso, endIso: s.endIso })), minutes: result.minutes };
  } catch {
    return null;
  }
};

type Hours = Promise<SlotPickerSeed | null>;

/** «Gratis · 15 minutos · Dayana te llama por WhatsApp». Los minutos salen de la agenda, no de aquí. */
const Facts = ({ minutes }: { minutes: number | null }) => <>Gratis · {minutes ? `${minutes} minutos · ` : ""}Dayana te llama por WhatsApp</>;
const FactsWhenKnown = async ({ hours }: { hours: Hours }) => <Facts minutes={(await hours)?.minutes ?? null} />;

/**
 * Los testimonios en video: primero los reales que ya existen (los de
 * `/historias`, en YouTube), después los espacios para los que Dayana mande.
 * Seis, como la página de referencia.
 */
const testimonials = (): VideoTestimonial[] => {
  const real: VideoTestimonial[] = TESTIMONIOS.filter((t) => t.youtubeId).map((t) => ({
    id: `yt-${t.id}`,
    kind: "video",
    ratio: "16/9",
    label: `Testimonio de ${t.name}`,
    brief: "",
    src: `https://www.youtube.com/watch?v=${t.youtubeId}`,
    name: t.name,
    result: t.cameFrom,
  }));
  return [...VIDEO_TESTIMONIALS.filter((v) => v.src), ...real, ...VIDEO_TESTIMONIALS.filter((v) => !v.src)].filter(visible).slice(0, 6);
};

// ── Piezas ────────────────────────────────────────────────────────────────────

const eyebrow = "font-[font2] text-xs uppercase tracking-[0.28em] text-terracotta";
const h2 = "font-[font2] text-[clamp(1.6rem,6vw,2.75rem)] uppercase leading-[0.98] tracking-tight text-linen";
const body = "font-[font1] text-base leading-relaxed text-linen/80 lg:text-lg";

/** El botón que se repite en la página: siempre lleva al formulario de abajo. */
const CtaButton = ({ label = "Agenda tu sesión 1 a 1 gratis" }: { label?: string }) => (
  <div className="flex flex-col items-center gap-2">
    <a
      href="#agenda"
      className="inline-flex min-h-14 w-full max-w-md items-center justify-center gap-2.5 rounded-full bg-linen px-8 py-4 text-center font-[font2] text-base uppercase leading-tight tracking-[0.06em] text-ink shadow-lg shadow-black/30 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-linen focus-visible:ring-offset-2 focus-visible:ring-offset-ink sm:text-lg"
    >
      <CalendarHeart className="size-5 shrink-0" aria-hidden="true" />
      {label}
    </a>
  </div>
);

/** El evento gratuito abierto, si hay: un botón extra, más discreto que el de la llamada. */
const FreeEventStrip = ({ event }: { event: { headline: string; href: string; when: string | null } }) => (
  <aside
    aria-label="Evento gratuito"
    className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 rounded-2xl border border-linen/20 bg-linen/[0.06] px-5 py-4 text-center sm:flex-row sm:justify-between sm:text-left"
  >
    <p className="font-[font1] text-sm leading-snug text-linen/85">
      <span className="block font-[font2] text-xs uppercase tracking-[0.2em] text-terracotta">Evento gratuito en vivo</span>
      {event.headline}
      {event.when ? <span className="block text-linen/60">{event.when}</span> : null}
    </p>
    <a
      href={event.href}
      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-linen/40 px-5 font-[font2] text-sm text-linen transition-colors hover:border-linen hover:bg-linen/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-linen"
    >
      Inscribirme gratis
    </a>
  </aside>
);

// ── La página ─────────────────────────────────────────────────────────────────

/**
 * La página de la sesión 1 a 1 gratis: a donde llegan los anuncios y los
 * enlaces de Instagram y TikTok. Copia la estructura de las páginas de venta
 * por llamada (video, prueba social, comunidad, quién es, formulario abajo):
 * una sola acción, repetida, que baja al formulario. La venta se cierra en la
 * llamada: aquí se presenta la oferta completa —sanar y después crecer— y
 * Dayana propone lo que cada persona necesita (sesiones, talleres o ambos).
 *
 * Si hay un evento gratuito abierto, sale un botón extra para inscribirse.
 */
const CallLandingPage = async () => {
  const [config, userCountry, freeEvent] = await Promise.all([
    getCallFunnelConfig(),
    getServerUserCountry().catch(() => null),
    getOpenFreeEvent().catch(() => null),
  ]);
  const open = config.enabled;
  // Sin `await`: la página no espera al calendario. Las horas llegan por streaming.
  const hours: Hours = open ? loadHours() : Promise.resolve(null);
  const whatsappUrl = buildWhatsAppUrl(WHATSAPP_MESSAGE);
  const wall = testimonials();
  const event = freeEvent
    ? { headline: freeEvent.headline, href: `${freeEvent.publicPath}?ref=llamada`, when: formatWebinarScheduleLabel(freeEvent) }
    : null;
  const story = FEATURED_STORY;
  const storyShots = story.screenshots.filter(visible);
  const showStory = visible(story.photo) || storyShots.length > 0;

  return (
    <main className="relative min-h-[100dvh] overflow-x-clip bg-ink text-linen">
      <ReturningLink className="absolute right-4 top-3 z-10 sm:right-6 [&_a]:text-linen [&_a]:decoration-linen/40 [&]:text-linen/60" />

      {/* 1. Arriba: quién, la promesa, el video y el botón. */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 pb-12 pt-12 text-center sm:px-6 sm:pt-16 lg:gap-8">
        <p className="font-[font2] text-xs uppercase tracking-[0.3em] text-linen/70">
          {BRAND.name} · <span className="normal-case tracking-normal">{BRAND.tagline}</span>
        </p>
        <h1 className="max-w-4xl font-[font2] text-[clamp(1.75rem,7vw,3.6rem)] uppercase leading-[0.98] tracking-tight text-linen">
          De sentirte sin energía a construir la vida <span className="text-terracotta">y el negocio que te dé propósito</span>
        </h1>
        <p className="max-w-2xl font-[font1] text-base leading-relaxed text-linen/80 sm:text-lg">
          Sesiones 1 a 1 con Dayana para sanar lo que hoy te frena y después crecer: tu propio negocio, tu marca personal, tu contenido.
        </p>
        {visible(MAIN_VIDEO) ? <MediaSlot slot={MAIN_VIDEO} className="max-w-4xl shadow-2xl shadow-black/50" sizes="(min-width: 1024px) 896px, 100vw" /> : null}
        <CtaButton />
        <p className="-mt-3 font-[font1] text-sm text-linen/60">
          <Suspense fallback={<Facts minutes={null} />}>
            <FactsWhenKnown hours={hours} />
          </Suspense>
        </p>
        {event ? <FreeEventStrip event={event} /> : null}
      </section>

      {/* 2. El muro de testimonios. */}
      {wall.length ? (
        <section aria-labelledby="testimonios" className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">
          <h2 id="testimonios" className={`${h2} text-center`}>
            Personas que ya hicieron su proceso con Dayana
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:gap-10">
            {wall.map((t) => (
              <figure key={t.id} className="flex flex-col gap-3">
                <MediaSlot slot={t} sizes="(min-width: 640px) 50vw, 100vw" />
                {t.name || t.result ? (
                  <figcaption className="text-center">
                    {t.name ? <span className="block font-[font2] text-base text-linen">{t.name}</span> : null}
                    {t.result ? <span className="block font-[font1] text-sm text-linen/70">{t.result}</span> : null}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
          <div className="mt-10">
            <CtaButton />
          </div>
        </section>
      ) : null}

      {/* 3. El método híbrido: primero sanas, después creces. */}
      <section aria-labelledby="metodo" className="bg-hero-paper text-ink">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:py-20">
          <p className={eyebrow}>El método de Dayana</p>
          <h2 id="metodo" className="mt-3 max-w-3xl font-[font2] text-[clamp(1.6rem,6vw,2.75rem)] uppercase leading-[0.98] tracking-tight text-ink">
            Primero sanas. Después creces.
          </h2>
          <p className="mt-4 max-w-2xl font-[font1] text-base leading-relaxed text-ink/75 lg:text-lg">
            Nadie construye algo propio desde el agotamiento. Por eso el trabajo con Dayana va en dos tiempos, a tu ritmo.
          </p>
          <ol className="mt-10 grid gap-6 md:grid-cols-2">
            {[
              {
                n: "01",
                t: "Sanar lo que te frena",
                d: "Sesiones de Programación Neurolingüística para soltar la tristeza, el cansancio, la ansiedad o lo que no has superado, y cambiar los hábitos que te tienen en el mismo lugar.",
              },
              {
                n: "02",
                t: "Crecer y construir lo tuyo",
                d: "Con la mente en su sitio, das el siguiente paso: tu propio negocio, tu marca personal, tu contenido en redes y tus primeros clientes. Algo que te dé propósito.",
              },
            ].map((s) => (
              <li key={s.n} className="rounded-3xl bg-paper p-6 sm:p-8">
                <span aria-hidden="true" className="font-[font2] text-4xl leading-none text-terracotta">
                  {s.n}
                </span>
                <h3 className="mt-4 font-[font2] text-xl uppercase leading-tight text-ink">{s.t}</h3>
                <p className="mt-3 font-[font1] text-base leading-relaxed text-ink/75">{s.d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 max-w-2xl font-[font1] text-base leading-relaxed text-ink/75">
            En la llamada gratis Dayana escucha dónde estás y te dice qué te sirve: sesiones 1 a 1, un taller o los dos.
          </p>
        </div>
      </section>

      {/* 4. La comunidad. */}
      <section aria-labelledby="comunidad" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:py-20">
        {visible(COMMUNITY_PHOTO) ? <MediaSlot slot={COMMUNITY_PHOTO} sizes="(min-width: 1024px) 1024px, 100vw" /> : null}
        <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-end">
          <div>
            <h2 id="comunidad" className={h2}>
              No vas a hacerlo en soledad
            </h2>
            <p className={`${body} mt-4`}>
              Te unes a una comunidad de personas que también decidieron dejar de sobrevivir y empezar a construir: se acompañan, comparten lo que
              aprenden y celebran cada paso.
            </p>
          </div>
          <p className="font-[font2] text-lg uppercase leading-tight tracking-tight text-terracotta md:text-right">Tu entorno cambia lo que crees posible.</p>
        </div>
        <div className="mt-10">
          <CtaButton label="Agenda una reunión gratis" />
        </div>
      </section>

      {/* 5. Una historia, con sus mensajes. */}
      {showStory ? (
        <section aria-labelledby="historia" className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6 lg:pb-20">
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            {visible(story.photo) ? <MediaSlot slot={story.photo} sizes="(min-width: 768px) 50vw, 100vw" /> : null}
            <div>
              <p className={eyebrow}>Una historia real</p>
              <h2 id="historia" className={`${h2} mt-3`}>
                {story.title || (SHOW_PENDING ? "[Título de la historia: lo manda Dayana]" : "")}
              </h2>
              {story.text || SHOW_PENDING ? <p className={`${body} mt-4`}>{story.text || "[Su historia en una o dos frases.]"}</p> : null}
            </div>
          </div>
          {storyShots.length ? (
            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-5 sm:grid-cols-3">
              {storyShots.map((shot) => (
                <MediaSlot key={shot.id} slot={shot} sizes="(min-width: 640px) 33vw, 100vw" />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 6. Conoce a Dayana. */}
      <section aria-labelledby="dayana" className="border-y border-linen/10 bg-black/40">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center lg:py-20">
          {visible(DAYANA_PHOTO) ? <MediaSlot slot={DAYANA_PHOTO} className="mx-auto max-w-sm bg-linen/5" sizes="(min-width: 768px) 384px, 90vw" /> : null}
          <div>
            <p className={eyebrow}>Conoce a Dayana</p>
            <h2 id="dayana" className={`${h2} mt-3`}>
              {BRAND.name}
            </h2>
            <p className={`${body} mt-4`}>
              Hola, soy Dayana, {BRAND.tagline.toLowerCase()}. Acompaño a personas que llegan sin energía, con tristeza o sin rumbo, primero a
              sanar lo que las frena y después a convertir lo que saben en algo propio: un negocio, una marca, un contenido que las represente.
            </p>
            <ul className="mt-6 space-y-3 font-[font1] text-base leading-relaxed text-linen/85">
              {[
                "Sesiones 1 a 1 de PNL para soltar lo que te pesa y cambiar tus hábitos.",
                "Acompañamiento para crear tu negocio, tu marca personal y tu contenido.",
                "Talleres y comunidad para que no avances en soledad.",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden="true" className="mt-1 text-terracotta">
                    ▶
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 7. El cierre: el formulario. */}
      <section id="agenda" aria-labelledby="agenda-titulo" className="mx-auto w-full max-w-3xl scroll-mt-4 px-4 py-16 sm:px-6 lg:py-20">
        <h2 id="agenda-titulo" className={`${h2} text-center`}>
          ¿Es tu momento de cambiar?
        </h2>
        <p className="mt-3 text-center font-[font2] text-lg text-linen/85">Agenda tu sesión 1 a 1 gratis ahora</p>
        <div className="mt-8">
          {open ? (
            <CallFunnel defaultCountry={userCountry} hours={hours} whatsappUrl={whatsappUrl} />
          ) : (
            <div className={funnelCard} data-testid="llamada-cerrada">
              <h3 className="font-[font2] text-2xl leading-tight text-foreground">Agenda tu llamada por WhatsApp</h3>
              <p className="mb-5 mt-2 font-[font1] text-base leading-relaxed text-muted-foreground">
                Escríbenos y buscamos contigo una hora para que Dayana te llame.
              </p>
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={primaryBtn} data-testid="llamada-whatsapp">
                <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                Agendar por WhatsApp
              </a>
            </div>
          )}
        </div>
        {event ? (
          <div className="mt-10">
            <p className="mb-3 text-center font-[font1] text-sm text-linen/60">¿Prefieres empezar por algo en grupo?</p>
            <FreeEventStrip event={event} />
          </div>
        ) : null}
      </section>

      {/* 8. Preguntas. */}
      <section aria-labelledby="preguntas" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="preguntas" className="font-[font2] text-xl uppercase tracking-tight text-linen">
          Preguntas frecuentes
        </h2>
        <div className="mt-4 divide-y divide-linen/15 border-y border-linen/15">
          {[
            { q: "¿La llamada tiene costo?", a: "No. Es gratis y no te compromete a nada." },
            {
              q: "¿Cómo es la llamada?",
              a: `Dayana te llama por WhatsApp a la hora ${open ? "que elijas" : "que acordemos"}. No hay enlace de videollamada: solo ten tu WhatsApp a mano y un lugar tranquilo.`,
            },
            {
              q: "¿Necesito tener un negocio o saber de redes?",
              a: "No. Muchas personas llegan sin nada armado y solo con ganas de sentirse mejor. Dayana te acompaña desde donde estás.",
            },
            {
              q: "¿Y los talleres?",
              a: "Los talleres y los procesos 1 a 1 se ven en la llamada: Dayana te dice cuál te conviene según lo que necesitas.",
            },
            {
              q: "¿Y si no puedo a la hora que elegí?",
              a: open
                ? "Al agendar te queda tu propia página. Desde ahí cambias la hora o cancelas antes de que empiece."
                : "Escríbenos por WhatsApp y buscamos otra hora.",
            },
          ].map((item) => (
            <details key={item.q} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 font-[font2] text-base leading-snug text-linen outline-none focus-visible:ring-2 focus-visible:ring-linen/60 [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden="true" className="shrink-0 font-[font1] text-2xl leading-none text-terracotta transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pb-5 pr-8 font-[font1] text-[0.95rem] leading-relaxed text-linen/70">{item.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-10">
          <a
            href="#agenda"
            className="mx-auto flex min-h-11 w-fit items-center gap-2 rounded-full px-3 font-[font2] text-sm text-linen/80 underline decoration-linen/30 underline-offset-4 hover:text-linen"
          >
            <ArrowDown className="size-4 rotate-180" aria-hidden="true" />
            Volver al formulario
          </a>
        </div>
      </section>

      <footer className="border-t border-linen/10">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 font-[font1] text-xs text-linen/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {BRAND.name} · {BRAND.tagline}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              { href: "/aviso-privacidad", label: "Aviso de privacidad" },
              { href: "/terminos", label: "Términos" },
              { href: "/cookies", label: "Cookies" },
            ].map((l) => (
              <Link key={l.href} href={l.href} prefetch={false} className="inline-flex min-h-11 items-center underline decoration-linen/25 underline-offset-4 hover:text-linen">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </main>
  );
};

export default CallLandingPage;
