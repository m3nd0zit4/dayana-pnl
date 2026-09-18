"use client";

import { Laptop, Users, MessageCircle } from "lucide-react";
import { Suspense } from "react";
import LocalScheduleChips from "@/app/components/datetime/LocalScheduleChips";
import WorkshopSlotLocalTime from "@/app/components/datetime/WorkshopSlotLocalTime";
import PublicProductCard from "@/app/components/productos/PublicProductCard";
import PortalCheckoutCta from "@/app/components/payments/PortalCheckoutCta";
import { BRAND, buildWhatsAppUrl } from "@/lib/contact";
import { DEFAULT_SCHEDULE_SECTION_TITLE, type WorkshopDetail } from "@/lib/workshops";
import type { Plan } from "@/lib/plans";

type Props = {
  workshop: WorkshopDetail;
  /** Ya resuelto por región y visibilidad (`isPlanVisibleForRegion`) — `null`
   *  significa "nada que cobrar", nunca "cárgalo tú". */
  plan: Plan | null;
  userCountry?: string | null;
  googleEnabled?: boolean;
  /** Informational only — never enforced as a hard cap (same rule as the webinar). */
  capacity?: number | null;
  /** Resuelto en el servidor: "open" solo cuando hay `plan`. */
  state: "open" | "closed" | "completed";
};

const scrollToPago = () => {
  document.getElementById("pago")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
};

const WorkshopSalesPage = ({
  workshop,
  plan,
  userCountry,
  googleEnabled = false,
  capacity,
  state,
}: Props) => {
  const isColombia = userCountry === "CO";
  const heroTitle = workshop.heroLines.filter(Boolean).join(" ") || workshop.title;
  const whatsappMessage =
    workshop.whatsappMessage?.trim() ||
    `Hola Dayana, me interesa el taller ${workshop.title}.`;
  const whatsappHref = buildWhatsAppUrl(whatsappMessage);

  const statusBadgeLabel =
    state === "open"
      ? "Inscripciones abiertas"
      : state === "completed"
        ? "Taller finalizado"
        : "Inscripciones cerradas";

  const ctaLabel =
    state === "open" ? "Inscribirme y pagar" : "Escríbenos por WhatsApp";

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#f0ece4] text-black">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(ellipse_at_20%_0%,rgba(237,195,177,0.5),transparent_55%),radial-gradient(ellipse_at_90%_10%,rgba(212,184,150,0.35),transparent_50%)]"
      />

      <section className="relative px-5 pb-12 pt-12 lg:px-12 lg:pb-16 lg:pt-16 xl:px-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-12">
          <div>
            <span className="inline-flex rounded-full bg-terracotta px-3.5 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.22em] text-white">
              {workshop.editionLabel || "Taller virtual"}
            </span>
            <h1 className="mt-4 font-[font2] text-[clamp(1.85rem,4.8vw,3.25rem)] uppercase leading-[0.95] tracking-tight">
              {heroTitle}
            </h1>
            {workshop.detailSummary && (
              <p className="mt-4 max-w-lg font-[font1] text-base leading-snug text-black/65 lg:text-lg">
                {workshop.detailSummary}
              </p>
            )}
            {workshop.intro?.trim() ? (
              <p className="mt-2 max-w-lg font-[font1] text-sm leading-snug text-black/50">
                {workshop.intro}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2.5">
              {workshop.startsAtIso ? (
                <LocalScheduleChips
                  startsAtIso={workshop.startsAtIso}
                  hasTime
                  userCountry={userCountry}
                />
              ) : (
                <>
                  {workshop.dateLabel ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm capitalize text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                      {workshop.dateLabel}
                    </span>
                  ) : null}
                  {workshop.scheduleLabel ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                      {workshop.scheduleLabel}
                    </span>
                  ) : null}
                </>
              )}
              <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                <Laptop className="h-4 w-4 text-terracotta" />
                En vivo · Online
              </span>
              {capacity ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/55 px-3.5 py-2 font-[font1] text-sm text-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-md">
                  <Users className="h-4 w-4 text-terracotta" />
                  Cupo para {capacity}
                </span>
              ) : null}
            </div>

            {/* El cupo es una expectativa, no un tope — igual que en el webinar. */}
            {capacity && state === "open" ? (
              <p className="mt-3 font-[font1] text-xs text-black/45">
                La sala está pensada para {capacity} personas. Si se llena
                escríbenos por WhatsApp y vemos cómo ayudarte.
              </p>
            ) : null}

            {/* Solo móvil: en desktop la tarjeta de pago ya está a la derecha. */}
            <button
              type="button"
              onClick={scrollToPago}
              className="mt-7 inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-8 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c] lg:hidden"
            >
              {ctaLabel}
            </button>
            <p className="mt-3 font-[font1] text-xs text-black/40 lg:hidden">
              {BRAND.shortName}
            </p>
          </div>

          <div
            id="pago"
            className="relative scroll-mt-24 rounded-[1.5rem] border border-white/50 bg-white/55 p-5 shadow-[0_24px_60px_-28px_rgba(92,74,58,0.45)] backdrop-blur-xl lg:p-7"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
            />

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-[font2] text-[10px] uppercase tracking-[0.2em] ${
                  state === "open"
                    ? "border-emerald-700/30 bg-emerald-700 text-white"
                    : "border-black/15 bg-white text-black/70"
                }`}
              >
                {statusBadgeLabel}
              </span>
            </div>

            {state === "open" && plan ? (
              <PublicProductCard
                plan={plan}
                isColombia={isColombia}
                size="sm"
                action={
                  <Suspense fallback={<div className="mt-6 h-[100px]" aria-hidden />}>
                    <PortalCheckoutCta
                      plan={plan}
                      userCountry={userCountry}
                      isDark={false}
                      googleEnabled={googleEnabled}
                      autopayReturnPath={`/taller-virtual/${workshop.slug}`}
                    />
                  </Suspense>
                }
              />
            ) : (
              <div>
                <h2 className="font-[font2] text-lg uppercase tracking-wide lg:text-xl">
                  {workshop.title}
                </h2>
                <p className="mt-4 font-[font1] text-sm leading-relaxed text-black/65">
                  {state === "completed"
                    ? "Este taller ya se realizó. Escríbenos por WhatsApp para avisarte de la próxima edición."
                    : "Las inscripciones para esta edición no están abiertas en este momento. Escríbenos por WhatsApp y te avisamos apenas se abra un cupo."}
                </p>
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex w-full items-center justify-center gap-2.5 rounded-full bg-terracotta px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.24em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c]"
                >
                  <MessageCircle className="h-4 w-4" />
                  Escríbenos por WhatsApp
                </a>
              </div>
            )}
          </div>
        </div>
      </section>

      {workshop.focusTopics.length > 0 && (
        <section className="relative border-t border-black/8 px-5 py-12 lg:px-12 lg:py-14 xl:px-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-[font2] text-xl uppercase tracking-wide lg:text-2xl">
              Lo que vas a trabajar
            </h2>
            {workshop.topicsSectionDescription ? (
              <p className="mt-3 font-[font1] text-sm leading-snug text-black/60 lg:text-base">
                {workshop.topicsSectionDescription}
              </p>
            ) : null}
            <ol className="mt-6 space-y-3">
              {workshop.focusTopics.map((item, i) => (
                <li key={`${i}-${item}`} className="flex gap-3">
                  <span className="font-[font2] text-sm tracking-[0.12em] text-terracotta">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[font1] text-base leading-snug text-black/80">
                    {item}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {workshop.daySchedule.length > 0 && (
        <section className="relative border-t border-black/8 px-5 py-12 lg:px-12 lg:py-14 xl:px-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-[font2] text-xl uppercase tracking-wide lg:text-2xl">
              {DEFAULT_SCHEDULE_SECTION_TITLE}
            </h2>
            {workshop.scheduleSectionDescription ? (
              <p className="mt-3 font-[font1] text-sm leading-snug text-black/60 lg:text-base">
                {workshop.scheduleSectionDescription}
              </p>
            ) : null}
            <div className="mt-6 space-y-2">
              {workshop.daySchedule.map((slot) => (
                <article
                  key={`${slot.startTime}-${slot.endTime}-${slot.title}`}
                  className="grid grid-cols-1 gap-2 rounded-2xl border border-black/10 bg-white px-4 py-4 lg:grid-cols-[200px_1fr] lg:gap-6 lg:px-5"
                >
                  <div className="font-[font2] text-xs uppercase tracking-[0.2em] text-black/55">
                    <WorkshopSlotLocalTime
                      slot={slot}
                      startsAtIso={workshop.startsAtIso}
                      scheduleTimezone={workshop.scheduleTimezone}
                      userCountry={userCountry}
                    />
                  </div>
                  <p className="font-[font1] text-sm leading-snug lg:text-base">
                    {slot.title}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="relative border-t border-black/8 px-5 py-10 lg:px-12 xl:px-20">
        <div className="mx-auto max-w-3xl text-center">
          <button
            type="button"
            onClick={scrollToPago}
            className="inline-flex items-center justify-center gap-3 rounded-full bg-terracotta px-8 py-3.5 font-[font2] text-xs uppercase tracking-[0.28em] text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-[#a8543c]"
          >
            {ctaLabel}
          </button>
        </div>
      </section>
    </main>
  );
};

export default WorkshopSalesPage;
