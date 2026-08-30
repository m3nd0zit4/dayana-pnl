import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/app/components/home/Footer";
import RevealScope from "@/app/components/common/RevealScope";
import DiagnosticCheckout from "@/app/components/diagnostico/DiagnosticCheckout";
import DiagnosticResultTracking from "@/app/components/diagnostico/DiagnosticResultTracking";
import {
  getDiagnosticByToken,
  markDiagnosticViewed,
  resolveRecommendation,
} from "@/lib/crm/diagnostics";
import {
  AUTHORITY_COPY,
  DIAGNOSTIC_PROFILES,
  METHOD_STEPS,
  OBJECTION_COPY,
  PAIN_COPY,
} from "@/lib/diagnostico/profiles";
import { answerLabels } from "@/lib/diagnostico/questions";
import { scoreDiagnostic, type DiagnosticProfileId } from "@/lib/diagnostico/scoring";
import { getServerUserCountry } from "@/lib/geo/user-country";
import { isFreeWebinarActive } from "@/lib/crm/free-webinar";
import { buildWhatsAppUrl } from "@/lib/contact";
import { formatCop, formatUsd } from "@/lib/plans";

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

  const pain =
    typeof diagnostic.answers.dolor === "string"
      ? PAIN_COPY[diagnostic.answers.dolor]
      : undefined;

  const manifestations = answerLabels(
    "manifestacion",
    diagnostic.answers.manifestacion,
  );
  const timeLabel = answerLabels("tiempo", diagnostic.answers.tiempo)[0] ?? null;

  // Se contesta la objeción que eligió, no las cinco. Enumerarlas todas obliga
  // a leer cuatro párrafos ajenos y, peor, planta dudas que no tenía.
  const objection =
    typeof diagnostic.answers.freno === "string"
      ? OBJECTION_COPY[diagnostic.answers.freno]
      : undefined;

  // "Por qué ella" sólo lo ve quien dijo que aún no lo sabe. A quien la sigue
  // hace tiempo o llegó por recomendación, repetírselo suena a relleno.
  const whyDayana = Array.isArray(diagnostic.answers.porqueDayana)
    ? diagnostic.answers.porqueDayana
    : [];
  const needsAuthority =
    whyDayana.length === 0 || whyDayana.includes("aun-no-lo-se");


  const whatsappUrl = buildWhatsAppUrl(
    `${copy.whatsappIntro}${
      manifestations.length ? ` Lo que más noto: ${manifestations[0].toLowerCase()}.` : ""
    } Me gustaría orientación antes de decidir.`,
  );

  const price = recommendation
    ? isColombia && recommendation.plan.amountCop != null
      ? formatCop(recommendation.plan.amountCop)
      : formatUsd(recommendation.plan.amountUsd)
    : null;

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

            {(timeLabel || manifestations.length > 0) && (
              <dl className="mt-7 grid gap-5 border-t border-black/10 pt-6 sm:grid-cols-2">
                {timeLabel && (
                  <div>
                    <dt className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/40">
                      Lo llevas sintiendo
                    </dt>
                    <dd className="mt-1.5 font-[font1] text-base">{timeLabel}</dd>
                  </div>
                )}
                {manifestations.length > 0 && (
                  <div>
                    <dt className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-black/40">
                      Y se te nota en
                    </dt>
                    <dd className="mt-1.5 font-[font1] text-base">
                      {manifestations.join(" · ")}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </section>

        {/* 2 · Lo que está pasando, según su dolor */}
        {pain && (
          <section className="reveal border-t border-black/10 bg-linen/40">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                {pain.title}
              </h2>
              <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
                {pain.body}
              </p>
            </div>
          </section>
        )}

        {/* 3 · Por qué no funcionó lo que ya intentó */}
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

        {/* 4 · El método */}
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

        {/* 4b · Por qué ella — sólo si hace falta */}
        {needsAuthority && (
          <section className="reveal border-t border-black/10">
            <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
              <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
                {AUTHORITY_COPY.title}
              </h2>
              <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
                {AUTHORITY_COPY.body}
              </p>
              <Link
                href="/dayana"
                className="mt-8 inline-block font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/50 underline underline-offset-4 transition-colors hover:text-black"
              >
                Conocer a Dayana
              </Link>
            </div>
          </section>
        )}

        {/* 4c · La objeción que ella misma nombró */}
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

        {/* 5 · La oferta: una sola */}
        <section
          id="oferta"
          className="reveal scroll-mt-20 border-t border-black/10"
        >
          <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-20">

            <h2 className="font-[font2] text-2xl uppercase leading-[0.95] sm:text-3xl">
              Tu camino recomendado
            </h2>
            <p className="mt-5 font-[font1] text-lg leading-relaxed text-black/75">
              {copy.offerFraming}
            </p>

            {recommendation ? (
              <div className="mt-9 rounded-3xl border border-black/12 bg-white/70 p-6 sm:p-8">
                <h3 className="font-[font2] text-2xl uppercase leading-tight">
                  {recommendation.plan.title}
                </h3>
                <p className="mt-1.5 font-[font1] text-sm text-black/50">
                  {recommendation.plan.sessions}
                </p>

                {price && (
                  <p className="mt-6 font-[font2] text-4xl leading-none">
                    {price}
                    {recommendation.plan.unitPrice && (
                      <span className="ml-2 font-[font1] text-base text-black/50">
                        {recommendation.plan.unitPrice}
                      </span>
                    )}
                  </p>
                )}

                {recommendation.plan.features.length > 0 && (
                  <ul className="mt-7 flex flex-col gap-2.5 border-t border-black/10 pt-6">
                    {recommendation.plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex gap-3 font-[font1] text-base leading-snug text-black/70"
                      >
                        <span aria-hidden className="text-terracotta">
                          ·
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}

                <DiagnosticCheckout
                  plan={recommendation.plan}
                  userCountry={userCountry}
                  token={token}
                />

                <p className="mt-6 border-t border-black/10 pt-5 font-[font1] text-sm leading-relaxed text-black/55">
                  {copy.riskReversal}
                </p>
              </div>
            ) : (
              // Sin producto vendible en su región no hay botón que pintar. En
              // vez de una tarjeta vacía se le manda a hablar, que es lo que
              // haría de todos modos.
              <div className="mt-9 rounded-3xl border border-black/12 bg-white/70 p-6 sm:p-8">
                <p className="font-[font1] text-lg leading-relaxed text-black/75">
                  Para tu país coordinamos el pago directamente. Escríbeme y lo
                  resolvemos en un minuto.
                </p>
              </div>
            )}

            {recommendation?.upgrade && (
              <p className="mt-7 font-[font1] text-base leading-relaxed text-black/60">
                Si quieres ir más a fondo, el siguiente escalón es{" "}
                <Link
                  href="/terapias"
                  className="underline underline-offset-4 hover:text-black"
                >
                  {recommendation.upgrade.title}
                </Link>
                .
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
                  antes de poner un peso, que es exactamente lo que necesitas
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

            <div className="mt-10 flex flex-col gap-4 border-t border-black/10 pt-8">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/60 underline underline-offset-4 transition-colors hover:text-black"
              >
                Prefiero hablarlo antes de decidir
              </a>
              <Link
                href="/terapias"
                className="font-[font2] text-[11px] uppercase tracking-[0.24em] text-black/40 underline underline-offset-4 transition-colors hover:text-black"
              >
                Ver todas las opciones
              </Link>
            </div>
          </div>
        </section>
        </main>
      </RevealScope>
      <Footer />
    </>
  );
};

export default ResultadoPage;
