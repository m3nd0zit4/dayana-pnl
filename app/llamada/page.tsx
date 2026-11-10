import { Suspense } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUp, MessageCircle } from "lucide-react";

import CallFunnel from "@/app/components/llamada/CallFunnel";
import ReturningLink from "@/app/components/llamada/ReturningLink";
import type { SlotPickerSeed } from "@/app/components/llamada/SlotPicker";
import { funnelCard, primaryBtn, textLink } from "@/app/components/llamada/styles";
import { BRAND, buildWhatsAppUrl } from "@/lib/contact";
import { TESTIMONIOS, type Testimonial } from "@/lib/content/testimonios";
import { getCallFunnelConfig } from "@/lib/crm/call-funnel/config";
import { funnelSlots } from "@/lib/crm/call-funnel/server";
import { getServerUserCountry } from "@/lib/geo/user-country";

const title = `Llamada gratis con ${BRAND.name} | Elige tu hora`;
const description =
  "Agenda una llamada gratis con Dayana Beltrán, Maestra en Programación Neurolingüística. Dejas tu nombre y tu WhatsApp, eliges la hora y ella te llama. Sin compromiso.";

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

// Lee el país de quien visita y los ajustes del embudo en cada pedido.
export const dynamic = "force-dynamic";

/** Dayana, recortada sobre transparente (la misma serie que usa `/enlaces`). 900 × 1200. */
const PHOTO = "/dayana-photos/opt/IMG_4009-900.webp";

const WHATSAPP_MESSAGE = "Hola, quiero agendar mi llamada gratis con Dayana.";

/** Las tres historias que se muestran, por su id en `lib/content/testimonios` (reales; aquí no se escribe ninguna). */
const STORY_IDS = [2, 4, 5];

/** Cuánto se espera por el calendario antes de seguir sin las horas (el selector las pide él mismo). */
const HOURS_TIMEOUT_MS = 2500;

/**
 * Las horas de ahora, para que el paso 3 abra con ellas y para saber cuánto
 * dura la llamada. Nunca lanza y nunca tarda más de `HOURS_TIMEOUT_MS`: `null`
 * si la agenda está cerrada, sin cupo o el calendario no contesta a tiempo.
 */
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

/** «15 minutos · Dayana te llama por WhatsApp · sin compromiso». Los minutos salen de la agenda, no de aquí. */
const Facts = ({ minutes }: { minutes: number | null }) => (
  <>
    {minutes ? `${minutes} minutos · ` : ""}Dayana te llama por WhatsApp · sin compromiso
  </>
);

const FactsWhenKnown = async ({ hours }: { hours: Hours }) => <Facts minutes={(await hours)?.minutes ?? null} />;

/** «Dura 15 minutos. », o nada si no se sabe. */
const DurationSentence = async ({ hours }: { hours: Hours }) => {
  const minutes = (await hours)?.minutes;
  return minutes ? <>Dura {minutes} minutos. </> : null;
};

const h2 = "font-[font2] text-[clamp(1.45rem,5vw,2.1rem)] uppercase leading-none tracking-tight text-foreground";

const STEPS_OPEN = [
  { title: "Dejas tus datos", text: "Tu nombre y tu WhatsApp. Nada más para empezar." },
  { title: "Eliges la hora", text: "Ves las horas libres de Dayana en tu zona horaria y te quedas con la que te sirva." },
  { title: "Dayana te llama por WhatsApp", text: "A la hora que elegiste. No hay enlace de videollamada: solo contestas." },
];

const STEPS_CLOSED = [
  { title: "Escribes por WhatsApp", text: "Con el botón de esta página el mensaje ya va escrito." },
  { title: "Acuerdan la hora", text: "Por ese mismo chat buscamos contigo una hora que te sirva." },
  { title: "Dayana te llama por WhatsApp", text: "A la hora acordada. No hay enlace de videollamada: solo contestas." },
];

const WhatsAppButton = ({ href, label }: { href: string; label: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={primaryBtn} data-testid="llamada-whatsapp">
    <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
    {label}
  </a>
);

/**
 * La página de la llamada gratis: a donde llegan los anuncios y los enlaces de
 * Instagram y TikTok, casi siempre en el celular. Una sola acción —dejar los
 * datos y elegir la hora— y el formulario a la vista al llegar. Todo se
 * renderiza en el servidor menos el formulario; aquí no hay GSAP ni Lenis.
 *
 * Con el embudo apagado en el CRM (`call.funnel.enabled`), la misma página con
 * un botón de WhatsApp en el lugar del formulario.
 */
const CallLandingPage = async () => {
  const [config, userCountry] = await Promise.all([getCallFunnelConfig(), getServerUserCountry().catch(() => null)]);
  const open = config.enabled;
  // Sin `await`: la página no espera al calendario. Las horas llegan por streaming.
  const hours: Hours = open ? loadHours() : Promise.resolve(null);
  const whatsappUrl = buildWhatsAppUrl(WHATSAPP_MESSAGE);
  const stories = STORY_IDS.map((id) => TESTIMONIOS.find((t) => t.id === id)).filter((t): t is Testimonial => Boolean(t));
  const steps = open ? STEPS_OPEN : STEPS_CLOSED;

  return (
    <main className="relative min-h-[100dvh] overflow-x-clip bg-background text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-gradient-to-b from-blush/45 to-transparent" />

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10">
        {/* Va sobre el margen de arriba, que ya existe: aparece al hidratar sin empujar nada. */}
        <ReturningLink className="absolute right-4 top-3 sm:right-6 lg:right-10" />

        {/* En escritorio el formulario ocupa las dos filas de la derecha. La segunda fila es la
            flexible: cuando el formulario crece (el paso 2 es más largo), «Cómo funciona» no se mueve. */}
        <div className="grid gap-x-14 gap-y-6 pb-14 pt-11 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:grid-rows-[auto_1fr] lg:items-start lg:pb-20 lg:pt-16">
          <header className="lg:col-start-1 lg:row-start-1 lg:pt-4">
            <div className="flex items-center gap-3">
              <span className="relative block size-14 shrink-0 overflow-hidden rounded-2xl bg-blush lg:size-16">
                {/* Sin `loading="eager"` a propósito: React precargaría la imagen con un
                    `<link>` en el `<head>`, delante de los que el layout escribe a mano,
                    y la hidratación del `<head>` dejaría de cuadrar. */}
                <Image src={PHOTO} alt="" fill sizes="128px" className="origin-[52%_28%] scale-[1.75] object-cover object-top" />
              </span>
              <p className="min-w-0">
                <span className="block font-[font2] text-sm uppercase tracking-[0.16em] text-foreground">{BRAND.name}</span>
                <span className="mt-0.5 block font-[font1] text-xs leading-snug text-muted-foreground">{BRAND.tagline}</span>
              </p>
            </div>

            <h1 className="mt-5 font-[font2] text-[clamp(1.7rem,7.4vw,3.5rem)] uppercase leading-[0.98] tracking-tight text-foreground">
              Habla con Dayana de lo que quieres cambiar, en una <span className="text-terracotta">llamada gratis</span>
            </h1>
            {/* Dos líneas reservadas en el celular: cuando llegan los minutos el texto crece y no empuja el formulario. */}
            <p className="mt-3 min-h-[2.75rem] font-[font1] text-[0.95rem] leading-snug text-muted-foreground sm:min-h-0 lg:mt-5 lg:text-lg">
              <Suspense fallback={<Facts minutes={null} />}>
                <FactsWhenKnown hours={hours} />
              </Suspense>
            </p>
          </header>

          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {open ? (
              <CallFunnel defaultCountry={userCountry} hours={hours} whatsappUrl={whatsappUrl} />
            ) : (
              <section id="agendar" aria-labelledby="agendar-titulo" className={funnelCard} data-testid="llamada-cerrada">
                <h2 id="agendar-titulo" className="font-[font2] text-2xl leading-tight text-foreground">
                  Agenda tu llamada por WhatsApp
                </h2>
                <p className="mb-5 mt-2 font-[font1] text-base leading-relaxed text-muted-foreground">
                  Escríbenos y buscamos contigo una hora para que Dayana te llame.
                </p>
                <WhatsAppButton href={whatsappUrl} label="Agendar por WhatsApp" />
              </section>
            )}
          </div>

          <section aria-labelledby="como-funciona" className="pt-6 lg:col-start-1 lg:row-start-2 lg:pt-8">
            <h2 id="como-funciona" className={h2}>
              Cómo funciona
            </h2>
            <ol className="mt-5 divide-y divide-border border-y border-border">
              {steps.map((step, i) => (
                <li key={step.title} className="flex gap-5 py-4">
                  <span aria-hidden="true" className="w-9 shrink-0 font-[font2] text-3xl leading-none text-terracotta">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-[font2] text-base leading-snug text-foreground">{step.title}</h3>
                    <p className="mt-1 font-[font1] text-[0.95rem] leading-relaxed text-muted-foreground">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section aria-labelledby="para-que" className="grid overflow-hidden rounded-3xl bg-secondary sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="p-6 sm:p-9 lg:p-12">
            <h2 id="para-que" className={h2}>
              Para qué sirve esta llamada
            </h2>
            <ul className="mt-5 max-w-xl space-y-3 font-[font1] text-base leading-relaxed text-foreground lg:text-lg">
              <li className="border-l-2 border-terracotta/60 pl-4">Le cuentas a Dayana, con tus palabras, qué quieres trabajar.</li>
              <li className="border-l-2 border-terracotta/60 pl-4">Ella te escucha y te explica cómo trabaja y cómo podría acompañarte.</li>
              <li className="border-l-2 border-terracotta/60 pl-4">Después decides tú, con calma. No hay ningún compromiso.</li>
            </ul>
            <p className="mt-5 max-w-xl font-[font1] text-sm leading-relaxed text-muted-foreground">
              Es una primera conversación, no una sesión de terapia.
            </p>
          </div>
          <figure className="flex items-end justify-center px-6 sm:pl-0 sm:pr-9 lg:pr-14">
            <Image
              src={PHOTO}
              alt={`${BRAND.name}, ${BRAND.tagline}`}
              width={900}
              height={1200}
              sizes="(min-width: 1024px) 270px, 195px"
              className="h-[16.25rem] w-auto lg:h-[22.5rem]"
            />
          </figure>
        </section>

        {stories.length ? (
          <section aria-labelledby="historias" className="py-14 lg:py-20">
            <h2 id="historias" className={h2}>
              Quienes ya trabajaron con Dayana
            </h2>
            <p className="mt-3 font-[font1] text-[0.95rem] leading-relaxed text-muted-foreground">
              Historias de personas que hicieron su proceso con ella.
            </p>
            <div className="mt-7 grid gap-8 lg:grid-cols-3 lg:gap-10">
              {stories.map((story) => (
                <figure key={story.id} className="border-l-2 border-terracotta/60 pl-5">
                  <blockquote className="font-[font1] text-base leading-relaxed text-foreground lg:text-[1.05rem]">«{story.excerpt}»</blockquote>
                  <figcaption className="mt-4 font-[font1] text-sm leading-snug text-muted-foreground">
                    <span className="font-[font2] text-foreground">{story.name}</span> · {story.cameFrom}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : (
          <div className="h-14 lg:h-20" />
        )}

        <section aria-labelledby="preguntas" className="grid gap-x-14 gap-y-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <h2 id="preguntas" className={h2}>
            Preguntas frecuentes
          </h2>
          <div className="divide-y divide-border border-y border-border">
            {[
              { q: "¿Tiene costo?", a: <>No. La llamada es gratis y no te compromete a nada.</> },
              {
                q: "¿Cómo es la llamada?",
                a: (
                  <>
                    <Suspense fallback={null}>
                      <DurationSentence hours={hours} />
                    </Suspense>
                    Dayana te llama por WhatsApp a la hora {open ? "que elegiste" : "acordada"}. No hay enlace de videollamada ni de Meet: solo ten tu
                    WhatsApp a mano.
                  </>
                ),
              },
              {
                q: "¿Y si no puedo a esa hora?",
                a: open ? (
                  <>Al agendar te queda tu propia página. Desde ahí puedes cambiar la hora o cancelar la llamada antes de que empiece.</>
                ) : (
                  <>Escríbenos por WhatsApp y buscamos otra hora.</>
                ),
              },
              {
                q: "¿Qué pasa después?",
                a: open ? (
                  <>
                    Apenas eliges la hora ves tu página con la fecha y la hora de tu llamada. Ahí puedes confirmarla por WhatsApp y añadirla a tu
                    calendario. A esa hora, Dayana te llama.
                  </>
                ) : (
                  <>Queda acordada la hora por WhatsApp y, cuando llega, Dayana te llama.</>
                ),
              },
            ].map((item) => (
              <details key={item.q} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-3 font-[font2] text-base leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span aria-hidden="true" className="shrink-0 font-[font1] text-2xl leading-none text-terracotta transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-2xl pb-5 pr-8 font-[font1] text-[0.95rem] leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="cierre" className="flex flex-col gap-5 py-14 sm:flex-row sm:items-center sm:justify-between lg:py-20">
          <h2 id="cierre" className={`${h2} max-w-xl`}>
            {open ? "Tu hora con Dayana se elige arriba" : "Tu hora con Dayana se acuerda por WhatsApp"}
          </h2>
          <div className="w-full shrink-0 sm:w-auto sm:min-w-[19rem]">
            {open ? (
              <a href="#agendar" className={primaryBtn}>
                <ArrowUp className="size-4 shrink-0" aria-hidden="true" />
                Volver arriba al formulario
              </a>
            ) : (
              <WhatsAppButton href={whatsappUrl} label="Agendar por WhatsApp" />
            )}
          </div>
        </section>
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 font-[font1] text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <p>
            © {BRAND.name} · {BRAND.tagline}
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/aviso-privacidad" prefetch={false} className={textLink}>
              Aviso de privacidad
            </Link>
            <Link href="/terminos" prefetch={false} className={textLink}>
              Términos
            </Link>
            <Link href="/cookies" prefetch={false} className={textLink}>
              Cookies
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
};

export default CallLandingPage;
