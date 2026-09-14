import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/app/components/home/Footer";
import RevealScope from "@/app/components/common/RevealScope";
import FaqSection from "@/app/components/servicios/FaqSection";
import DiagnosticContactCta from "@/app/components/diagnostico/DiagnosticContactCta";
import PublicProductCard from "@/app/components/productos/PublicProductCard";
import DiagnosticResultTracking from "@/app/components/diagnostico/DiagnosticResultTracking";
import {
  getDiagnosticByToken,
  markDiagnosticViewed,
  resolveRecommendation,
} from "@/lib/crm/diagnostics";
import {
  AUTHORITY_COPY,
  DIAGNOSTIC_PROFILES,
  GROWTH_COPY,
  METHOD_STEPS,
  OBJECTION_COPY,
  PAIN_COPY,
} from "@/lib/diagnostico/profiles";
import { answerLabels } from "@/lib/diagnostico/questions";
import { scoreDiagnostic, type DiagnosticProfileId } from "@/lib/diagnostico/scoring";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { isFreeWebinarActive } from "@/lib/crm/free-webinar";
import { buildWhatsAppUrl } from "@/lib/contact";

export const dynamic = "force-dynamic";

/**
 * La página lleva datos personales tras una URL adivinable sólo por fuerza
 * bruta. `noindex` es lo que impide que acabe en un buscador el día que
 * alguien comparta su enlace en un foro.
 */
export const metadata: Metadata = {
  title: "Tu resultado | Dayana Beltrán PNL",
  robots: { index: false, follow: false },
};

const ResultadoPage = async ({
  params,
}: {
  params: Promise<{ token: string }>;
}) => {
  const { token } = await params;

  const diagnostic = await getDiagnosticByToken(token);
  // Un diagnóstico sin cerrar no tiene resultado que enseñar. Se responde 404
  // igual que un token inexistente: distinguirlos sólo ayudaría a quien esté
  // probando tokens.
  if (!diagnostic || !diagnostic.completedAt || !diagnostic.profile) {
    notFound();
  }

  const userCountry = await getServerUserCountry().catch(() => null);
  const isColombia = userCountry === "CO";

  // El perfil guardado manda —es lo que vio la persona y lo que ve Dayana en
  // el CRM—; sólo se recalcula el score para saber cuál es el escalón
  // siguiente, que no se persiste.
  const profile = diagnostic.profile as DiagnosticProfileId;
  const score = scoreDiagnostic(diagnostic.answers);
  const copy = DIAGNOSTIC_PROFILES[profile];

  const recommendation = await resolveRecommendation(
    diagnostic.recommendedProductId ?? score.recommendedProductId,
    score.upgradeProductId,
    isColombia,
  );

  // El webinar sólo se ofrece a quien dijo que está explorando. Ponerlo
  // delante de alguien que ya decidió empezar es regalarle una excusa
  // gratuita para aplazar la decisión un mes más.
  const showWebinar =
    profile === "EXPLORADOR" && (await isFreeWebinarActive().catch(() => false));

  await markDiagnosticViewed(token);

  // Cuál de las dos mitades del cuestionario contestó decide de dónde sale el
  // bloque de "lo que está pasando" — nunca las dos a la vez, porque sólo una
  // de las dos preguntas de foco se le llegó a mostrar.
  const pain =
    profile !== "EN_EXPANSION" &&
    typeof diagnostic.answers["foco-emocional"] === "string"
      ? PAIN_COPY[diagnostic.answers["foco-emocional"] as string]
      : undefined;
  const growth =
    profile === "EN_EXPANSION" &&
    typeof diagnostic.answers["foco-crecimiento"] === "string"
      ? GROWTH_COPY[diagnostic.answers["foco-crecimiento"] as string]
      : undefined;
  const focusCopy = pain ?? growth;

  const timeLabel = answerLabels("tiempo", diagnostic.answers.tiempo)[0] ?? null;

  // Se contesta la objeción que eligió, no todas. Enumerarlas obliga a leer
  // párrafos ajenos y, peor, planta dudas que no tenía.
  const objection =
    typeof diagnostic.answers.cierre === "string"
      ? OBJECTION_COPY[diagnostic.answers.cierre]
      : undefined;

  // "Por qué ella" sólo se le muestra a quien llegó por un canal frío —
  // `source` nulo o publicidad—, donde nadie le presentó a Dayana antes. A
  // quien viene de `enlaces`/`home`/`historias` (contenido suyo) repetírselo
  // suena a relleno.
  const needsAuthority = diagnostic.source == null || diagnostic.source === "ad";

  // El mensaje lleva el perfil, el foco y el proceso recomendado: Dayana ve de
  // un vistazo con quién habla sin tener que abrir el CRM.
  const whatsappUrl = buildWhatsAppUrl(
    `${copy.whatsappIntro}${
      focusCopy ? ` Lo que más resuena: ${focusCopy.title.toLowerCase()}.` : ""
    }${
      recommendation ? ` Me recomendó ${recommendation.plan.title}.` : ""
    } Me gustaría hablar contigo para empezar.`,
  );

  return (
    <>
      <DiagnosticResultTracking profile={profile} />
      <RevealScope className="bg-hero-paper text-ink" selector=".reveal">
        <main>
        {/* 1 · El espejo */}
        <section className="mx-auto w-full max-w-3xl px-5 pb-16 pt-24 sm:px-8 sm:pt-32">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            Tu resultado
          </p>
          <h1 className="mt-5 font-[font2] text-4xl uppercase leading-[0.92] sm:text-6xl">
            {copy.name}
          </h1>
          <p className="mt-6 max-w-xl font-[font1] text-xl leading-snug text-black/70 sm:text-2xl">
            {copy.tagline}
          </p>

          <div className="mt-10 rounded-3xl border border-black/10 bg-white/50 p-6 sm:p-8">
            <p className="font-[font1] text-lg leading-relaxed text-black/80">
              {copy.mirror}
            </p>

            {timeLabel && (
              <dl className="mt-7 grid gap-5 border-t border-black/10 pt-6">
                <div>
                  <dt className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/40">
                    Le llevas dando vueltas
                  </dt>
                  <dd className="mt-1.5 font-[font1] text-base">{timeLabel}</dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        {/*
          2 · El camino recomendado, inmediatamente — sin precio.

          El resultado recomienda un proceso y termina en hablar con Dayana por
          WhatsApp, no en un botón de pago: el precio se habla en la
          conversación, con la persona ya presentada.

          Estuvo la séptima: espejo, dolor, por qué falló, método, autoridad y
          objeción antes del precio. Quien termina el cuestionario quiere ver
          qué le toca, no leer seis bloques primero — y de hecho no lo veía,
          porque además la sección llevaba `.reveal` y `gsap.from` la deja a
          `opacity: 0` hasta que dispara su ScrollTrigger. El argumento sigue
          entero, debajo, para quien lo necesite antes de decidir.
        */}
        <section
          id="oferta"
          className="scroll-mt-20 border-t border-black/10"
        >
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">

            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              Tu camino recomendado
            </h2>
            <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
              {copy.offerFraming}
            </p>

            {recommendation ? (
              <div className="mt-9">
                <PublicProductCard
                  plan={recommendation.plan}
                  isColombia={isColombia}
                  hidePrice
                  action={
                    <DiagnosticContactCta
                      href={whatsappUrl}
                      token={token}
                      profile={profile}
                      label={copy.ctaLabel}
                      className="mt-8"
                    />
                  }
                  footnote={copy.riskReversal}
                />
              </div>
            ) : (
              // Sin producto visible en su región no hay tarjeta que pintar —
              // pasa si el catálogo se queda sin precio en su moneda. La
              // salida es la misma que con tarjeta: hablar con Dayana.
              <div className="mt-9 rounded-3xl border border-black/12 bg-white/70 p-6 sm:p-8">
                <p className="font-[font1] text-lg leading-relaxed text-black/75">
                  Tu proceso ya está definido. Escríbeme y lo empezamos.
                </p>
                <DiagnosticContactCta
                  href={whatsappUrl}
                  token={token}
                  profile={profile}
                  label={copy.ctaLabel}
                  className="mt-6"
                />
              </div>
            )}

            {recommendation?.upgrade && (
              <p className="mt-7 font-[font1] text-base leading-relaxed text-black/60">
                Si quieres ir más a fondo, el siguiente escalón es{" "}
                {recommendation.upgrade.title}. Escríbeme y te paso el enlace.
              </p>
            )}

            {showWebinar && (
              <div className="mt-10 rounded-3xl border border-terracotta/30 bg-terracotta/[0.06] p-6 sm:p-8">
                <p className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-terracotta">
                  Antes de decidir
                </p>
                <h3 className="mt-3 font-[font2] text-xl uppercase leading-tight">
                  Ven al webinar gratuito
                </h3>
                <p className="mt-3 font-[font1] text-base leading-relaxed text-black/70">
                  Es en vivo y no cuesta nada. Vas a ver cómo trabaja Dayana
                  antes de dar el paso, que es exactamente lo que necesitas
                  para decidir con información y no con fe.
                </p>
                <Link
                  href="/webinar-gratuito"
                  className="mt-6 inline-block rounded-full border border-ink px-7 py-3 font-[font2] text-xs uppercase tracking-[0.18em] transition-colors hover:bg-ink hover:text-paper"
                >
                  Reservar mi lugar
                </Link>
              </div>
            )}

          </div>
        </section>
        {/* 3 · Lo que está pasando, según su foco (dolor o crecimiento) */}
        {focusCopy && (
          <section className="reveal border-t border-black/10 bg-linen/40">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                {focusCopy.title}
              </h2>
              <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
                {focusCopy.body}
              </p>
            </div>
          </section>
        )}

        {/* 4 · Por qué no funcionó lo que ya intentó */}
        <section className="reveal border-t border-black/10">
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              Por qué no ha funcionado hasta ahora
            </h2>
            <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
              {copy.whyItFailed}
            </p>
          </div>
        </section>

        {/* 5 · El método */}
        <section className="reveal border-t border-black/10 bg-linen/40">
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              Cómo se trabaja
            </h2>
            <ol className="mt-9 flex flex-col gap-8">
              {METHOD_STEPS.map((methodStep, i) => (
                <li key={methodStep.title} className="flex gap-5">
                  <span className="font-[font2] text-sm text-terracotta">
                    0{i + 1}
                  </span>
                  <div>
                    <h3 className="font-[font2] text-lg uppercase leading-tight">
                      {methodStep.title}
                    </h3>
                    <p className="mt-2 font-[font1] text-base leading-relaxed text-black/70">
                      {methodStep.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <Link
              href="/historias"
              className="mt-10 inline-block font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/50 underline underline-offset-4 transition-colors hover:text-black"
            >
              Ver historias de personas como tú
            </Link>
          </div>
        </section>

        {/* 6 · Por qué ella — sólo si hace falta */}
        {needsAuthority && (
          <section className="reveal border-t border-black/10">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                {AUTHORITY_COPY.title}
              </h2>
              <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
                {AUTHORITY_COPY.body}
              </p>
            </div>
          </section>
        )}

        {/* 7 · La objeción que ella misma nombró */}
        {objection && (
          <section className="reveal border-t border-black/10 bg-linen/40">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                {objection.title}
              </h2>
              <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
                {objection.body}
              </p>
            </div>
          </section>
        )}

          <FaqSection />
        </main>
      </RevealScope>
      <Footer />
    </>
  );
};

export default ResultadoPage;
