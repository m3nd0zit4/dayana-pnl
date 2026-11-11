import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";

import MediaSlot from "@/app/components/llamada/MediaSlot";
import MyCall from "@/app/components/llamada/MyCall";
import { MyCallPick } from "@/app/components/llamada/MyCallPick";
import { body, eyebrow, h1, h2, lead, primaryBtn, tapLink } from "@/app/components/llamada/MyCallUi";
import { MyCallWhen } from "@/app/components/llamada/MyCallWhen";
import { BRAND, buildWhatsAppUrl } from "@/lib/contact";
import { BOOKED_VIDEO } from "@/lib/content/llamada-landing";
import { getFunnelPage, type FunnelPage } from "@/lib/crm/call-funnel/server";

export const dynamic = "force-dynamic";

/**
 * La página lleva la cita de una persona tras un enlace secreto. `noindex` y
 * sin canónica (la del sitio apuntaría a la portada); el título es el mismo
 * para todos: el nombre nunca va en los metadatos. `referrer: same-origin`
 * para que la dirección —que ES el secreto— no viaje como referente a WhatsApp,
 * Google Calendar ni a ningún otro sitio al que se salga desde aquí.
 */
export const metadata: Metadata = {
  title: "Tu llamada con Dayana",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  referrer: "same-origin",
};

type PageProps = { params: Promise<{ token: string }> };

const STEPS = [
  {
    title: "Te llama por WhatsApp",
    text: "A la hora de tu llamada, Dayana te llama desde su número. No hay enlace ni videollamada: ten tu WhatsApp a la mano.",
  },
  {
    title: "Busca un espacio tranquilo",
    text: "Un lugar donde puedas hablar sin interrupciones durante esos minutos.",
  },
  {
    title: "Es una conversación",
    text: "Dayana te escucha: dónde estás hoy y adónde quieres llegar, ya sea tu paz, tu negocio o tu marca.",
  },
  {
    title: "Te cuenta qué te ayudaría",
    text: "Según lo que le cuentes, te propone el camino: sesiones 1 a 1, un taller o las dos cosas. La llamada es gratis.",
  },
] as const;

/** «Qué va a pasar»: texto fijo, se pinta en el servidor y entra en `MyCall` como hijo. */
const WhatHappens = () => (
  <section aria-labelledby="mi-llamada-que-pasa" className="mt-12 border-t border-foreground/10 pt-10">
    <h2 id="mi-llamada-que-pasa" className={h2}>
      Qué va a pasar
    </h2>
    <ol className="mt-6 flex flex-col gap-6">
      {STEPS.map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span aria-hidden="true" className="pt-0.5 font-[font2] text-sm tabular-nums text-primary">
            0{i + 1}
          </span>
          <div>
            <h3 className="font-[font2] text-base leading-snug">{step.title}</h3>
            <p className={`mt-1 ${body}`}>{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  </section>
);

/**
 * La hora de la llamada ya pasó. Aquí no se ofrece el selector de horas: una
 * segunda llamada gratis la decide Dayana, así que el siguiente paso es
 * escribirle.
 */
const PastCall = ({ page }: { page: FunnelPage }) => {
  const talked = page.stage === "hablaron";
  // `helpUrl` dice «quiero elegir una hora»: sirve para coordinar otra, no para
  // quien ya habló con ella.
  const href = talked
    ? buildWhatsAppUrl(`Hola Dayana, soy ${page.firstName}. Ya tuve mi llamada contigo y quiero saber cuál es el siguiente paso.`)
    : page.helpUrl;
  return (
    <>
      <p className={eyebrow}>Tu llamada gratis</p>
      <h1 className={`mt-4 ${h1}`}>{talked ? `Gracias por tu tiempo, ${page.firstName}` : "¿No pudieron hablar?"}</h1>
      <p className={`mt-4 ${lead}`}>
        {talked
          ? "Ya tuviste tu llamada con Dayana. Si quieres seguir, el siguiente paso es escribirle por WhatsApp."
          : page.stage === "no_contesto"
            ? "La hora de tu llamada ya pasó. Escríbele a Dayana por WhatsApp y coordinan una nueva hora."
            : "La hora de tu llamada ya pasó. Si no alcanzaron a hablar, escríbele a Dayana por WhatsApp y coordinan una nueva hora."}
      </p>
      {!talked && page.call ? (
        <div className="mt-3">
          <MyCallWhen variant="line" startIso={page.call.startIso} fallbackTz={page.personTz ?? page.dayanaTz} dayanaTz={page.dayanaTz} />
        </div>
      ) : null}
      <a href={href} target="_blank" rel="noopener noreferrer" className={`mt-8 ${primaryBtn}`}>
        <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
        {talked ? "Escribirle a Dayana" : "Coordinar una nueva hora"}
      </a>
    </>
  );
};

/**
 * La página de quien ya se registró en `/llamada` (contrato:
 * `docs/embudo-llamada.md`). Aquí aterriza al elegir su hora y aquí vuelve
 * desde el enlace que guardó. Va sin el menú del sitio: arriba solo el nombre
 * de Dayana, una columna, y al final la ayuda y los enlaces legales.
 *
 * Un enlace que no existe responde 404, igual que uno mal escrito.
 */
const MyCallPage = async ({ params }: PageProps) => {
  const { token } = await params;
  const page = await getFunnelPage(token);
  if (!page) notFound();

  const past = page.stage === "hablaron" || page.stage === "no_contesto" || page.stage === "pasada";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background font-[font1] text-foreground">
      <header className="mx-auto w-full max-w-xl px-5 pt-5 sm:px-6 sm:pt-8">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- carga completa a propósito */}
        <a
          href="/"
          className="inline-flex min-h-11 items-center rounded-sm font-[font2] text-xs uppercase tracking-[0.3em] text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {BRAND.name}
        </a>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-5 pb-14 pt-8 sm:px-6 sm:pt-12">
        {page.stage === "agendada" && page.call ? (
          <>
            {/* El video de Dayana apenas agenda (dueño, 11-nov). En producción, solo cuando exista el archivo. */}
            {BOOKED_VIDEO.src || process.env.VERCEL_ENV !== "production" ? (
              <MediaSlot slot={BOOKED_VIDEO} className="mb-8" sizes="(min-width: 640px) 576px, 100vw" />
            ) : null}
            <MyCall token={token} page={page} call={page.call}>
              <WhatHappens />
            </MyCall>
          </>
        ) : past ? (
          <PastCall page={page} />
        ) : (
          <MyCallPick
            token={token}
            helpUrl={page.helpUrl}
            heading={page.stage === "cancelada" ? "Tu llamada quedó cancelada" : `${page.firstName}, te falta elegir tu hora`}
            lead={
              page.stage === "cancelada"
                ? "Puedes elegir otra hora cuando quieras."
                : "Elige la que mejor te quede. Dayana te llama por WhatsApp a esa hora."
            }
          />
        )}
      </main>

      <footer className="mx-auto w-full max-w-xl px-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="border-t border-foreground/10 pt-6">
          <p className={body}>
            ¿Necesitas ayuda?{" "}
            <a href={page.helpUrl} target="_blank" rel="noopener noreferrer" className={tapLink}>
              Escríbenos por WhatsApp
            </a>
          </p>
          <nav aria-label="Legal" className="mt-1 flex flex-wrap gap-x-5 font-[font1] text-[13px] text-muted-foreground">
            {[
              { href: "/aviso-privacidad", label: "Aviso de privacidad" },
              { href: "/terminos", label: "Términos" },
              { href: "/cookies", label: "Cookies" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-sm underline decoration-foreground/20 underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default MyCallPage;
