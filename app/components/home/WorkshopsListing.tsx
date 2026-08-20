"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { Suspense, useRef } from "react";
import {
  WORKSHOPS,
  getWorkshopStatusLabel,
  type WorkshopCard,
} from "../../../lib/workshops";
import type { Plan } from "../../../lib/plans";
import { isPlanVisibleForRegion } from "../../../lib/pricing/plan-visibility";
import PortalCheckoutCta from "../payments/PortalCheckoutCta";
import LocalInstantText from "@/app/components/datetime/LocalInstantText";

gsap.registerPlugin(ScrollTrigger);

const statusBadgeClass = (status: WorkshopCard["status"]) => {
  if (status === "completed") {
    return "border-black/20 bg-black text-white";
  }
  if (status === "open") {
    return "border-emerald-700/30 bg-emerald-700 text-white";
  }
  return "border-black/15 bg-white text-black/80";
};

const statusDotClass = (status: WorkshopCard["status"]) => {
  if (status === "completed") return "bg-emerald-600";
  if (status === "open") return "bg-emerald-500";
  return "bg-amber-500";
};

const UpcomingWorkshopCard = () => (
  <article
    className="wk-card group relative flex min-h-[300px] items-center justify-center overflow-hidden rounded-3xl border border-white/45 bg-white/15 p-8 shadow-[0_20px_50px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-xl"
    aria-label="Próximo taller — próximamente"
  >
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-gradient-to-br from-linen/55 via-white/25 to-blush/45"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-sand/40 blur-3xl"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-blush/45 blur-3xl"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-white/20 backdrop-blur-md"
    />
    <span className="relative font-[font2] text-3xl uppercase tracking-[0.28em] text-black/60 lg:text-4xl">
      Próximamente
    </span>
  </article>
);

type WorkshopCardItemProps = {
  workshop: WorkshopCard;
  plan?: Plan | null;
  userCountry?: string | null;
  googleEnabled?: boolean;
  hasAccess?: boolean;
};

const WorkshopCardItem = ({
  workshop,
  plan,
  userCountry,
  googleEnabled = false,
  hasAccess = false,
}: WorkshopCardItemProps) => {
  if (workshop.status === "upcoming") {
    return <UpcomingWorkshopCard />;
  }

  const statusLabel = getWorkshopStatusLabel(workshop.status);
  const isColombia = userCountry === "CO";
  const visiblePlan = plan && isPlanVisibleForRegion(plan, isColombia) ? plan : null;

  return (
    <article className="wk-card group flex h-full flex-col rounded-3xl border border-black/15 bg-white p-6 lg:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.05)] transition-transform duration-300 hover:-translate-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-black/15 px-3 py-1 font-[font2] text-[10px] uppercase tracking-[0.22em] text-black/70">
          {workshop.editionLabel}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 font-[font2] text-[10px] uppercase tracking-[0.22em] ${statusBadgeClass(workshop.status)}`}
        >
          {statusLabel}
        </span>
      </div>

      <h2 className="font-[font2] mt-5 text-3xl lg:text-4xl uppercase leading-[0.92]">
        {workshop.title}
      </h2>
      <p className="font-[font1] mt-3 flex-1 text-sm lg:text-base leading-snug text-black/72">
        {workshop.cardSummary}
      </p>

      <div className="mt-6 rounded-2xl border border-black/10 bg-[#faf7f2] px-4 py-3">
        <div className="flex items-center gap-2 font-[font2] text-[10px] uppercase tracking-[0.2em] text-black/55">
          <span
            className={`inline-block h-2 w-2 rounded-full ${statusDotClass(workshop.status)}`}
            aria-hidden
          />
          {statusLabel}
        </div>
        <div className="font-[font1] mt-1 text-lg leading-tight">
          {workshop.startsAtIso ? (
            <LocalInstantText
              startsAtIso={workshop.startsAtIso}
              mode="date"
              userCountry={userCountry}
              placeholder={workshop.dateLabel || "…"}
            />
          ) : (
            workshop.dateLabel
          )}
        </div>
        <div className="font-[font1] text-sm text-black/60">
          {workshop.startsAtIso ? (
            <LocalInstantText
              startsAtIso={workshop.startsAtIso}
              mode="timeWithPlace"
              userCountry={userCountry}
              placeholder={workshop.scheduleLabel || "…"}
            />
          ) : (
            workshop.scheduleLabel
          )}
        </div>
      </div>

      {workshop.status === "open" ? (
        <div className="mt-4">
          {hasAccess ? (
            <Link
              href={`/taller-virtual/${workshop.slug}`}
              className="inline-flex w-full items-center justify-center rounded-full bg-black px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.2em] text-white transition-colors hover:bg-black/85"
            >
              Ver taller
            </Link>
          ) : visiblePlan ? (
            <Suspense fallback={<div className="h-[60px]" aria-hidden />}>
              <PortalCheckoutCta
                plan={visiblePlan}
                userCountry={userCountry}
                isDark={false}
                googleEnabled={googleEnabled}
                autopayReturnPath="/taller-virtual"
              />
            </Suspense>
          ) : (
            <p className="mt-2 text-center font-[font1] text-sm text-black/55">
              El pago en línea para este taller aún no está configurado.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
};

type WorkshopsListingProps = {
  workshops?: WorkshopCard[];
  /** Plan por productId de cada taller abierto — habilita el pago en tarjeta. */
  plans?: Record<string, Plan>;
  userCountry?: string | null;
  googleEnabled?: boolean;
  /** Por slug: true si el visitante ya puede entrar (owner o ya inscrito) — la
   *  tarjeta muestra "Ver taller" en vez del botón de pago. */
  accessBySlug?: Record<string, boolean>;
};

const WorkshopsListing = ({
  workshops: workshopsProp,
  plans,
  userCountry,
  googleEnabled = false,
  accessBySlug,
}: WorkshopsListingProps) => {
  const workshops = workshopsProp ?? WORKSHOPS;
  const rootRef = useRef<HTMLElement>(null);
  const hasOpen = workshops.some((w) => w.status === "open");

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".wk-list-reveal").forEach((el, i) => {
        gsap.from(el, {
          y: 36,
          opacity: 0,
          duration: 0.85,
          delay: i * 0.05,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 90%" },
        });
      });

      gsap.utils.toArray<HTMLElement>(".wk-card").forEach((el, i) => {
        gsap.from(el, {
          y: 48,
          opacity: 0,
          duration: 0.9,
          delay: i * 0.08,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
        });
      });
    },
    { scope: rootRef }
  );

  return (
    <section ref={rootRef} data-nav-color="black" className="min-h-screen bg-[#faf7f2] text-black">
      <div className="mx-auto max-w-[1400px] px-3 pb-24 pt-24 lg:px-8 lg:pt-28">
        <div className="wk-list-reveal">
          <span className="inline-flex items-center rounded-full border border-black/15 px-4 py-1.5 font-[font2] text-[10px] uppercase tracking-[0.25em]">
            Talleres virtuales
          </span>
        </div>

        <h1 className="wk-list-reveal mt-6 font-[font2] text-[14vw] uppercase leading-[0.86] md:text-[10vw] lg:text-[7.5vw]">
          Talleres
        </h1>
        <p className="wk-list-reveal mt-6 max-w-3xl font-[font1] text-lg leading-snug text-black/78 lg:text-2xl">
          {hasOpen
            ? "Jornadas intensivas de transformación con Dayana Beltrán. Hay inscripciones abiertas: entra al taller activo para ver el programa completo."
            : "Jornadas intensivas de transformación con Dayana Beltrán. Cuando abramos una nueva edición, la verás aquí."}
        </p>

        <div className="wk-list-reveal mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">
          {workshops.map((workshop) => (
            <WorkshopCardItem
              key={workshop.slug}
              workshop={workshop}
              plan={
                workshop.productId ? plans?.[workshop.productId] ?? null : null
              }
              userCountry={userCountry}
              googleEnabled={googleEnabled}
              hasAccess={accessBySlug?.[workshop.slug] ?? false}
            />
          ))}
        </div>

        <article className="wk-list-reveal mt-14 rounded-3xl border border-black/10 bg-black p-7 text-white lg:p-10">
          <div className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-white/60">
            ¿Quieres el siguiente taller?
          </div>
          <p className="mt-4 max-w-2xl font-[font1] text-base leading-snug text-white/82 lg:text-xl">
            Cuando abramos una nueva edición, la verás aquí. Mientras tanto,
            puedes explorar terapias y cursos en vivo.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/servicios"
              className="inline-flex items-center justify-center rounded-full bg-linen px-6 py-3.5 font-[font2] text-xs uppercase tracking-[0.2em] text-black transition-colors hover:bg-white sm:flex-1"
            >
              Ver servicios
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
};

export default WorkshopsListing;
