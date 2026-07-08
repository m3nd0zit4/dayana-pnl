"use client";

import Link from "next/link";
import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";

const WARN_DISMISS_KEY = "portal-membership-warning-dismissed";

/** Dismissible top banner for the grace window — content stays usable. */
export const MembershipWarningBanner = ({
  daysUntilBlocked,
}: {
  daysUntilBlocked: number;
}) => {
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      sessionStorage.getItem(WARN_DISMISS_KEY) === "1"
  );

  if (dismissed) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
      <div className="min-w-0 flex-1 text-sm text-amber-900">
        <p className="font-medium">
          Tu mensualidad venció.{" "}
          {daysUntilBlocked > 0
            ? `Tienes ${daysUntilBlocked} día${daysUntilBlocked === 1 ? "" : "s"} más antes de perder el acceso.`
            : "Hoy es tu último día de acceso."}
        </p>
        <Button
          size="sm"
          className="mt-2.5"
          nativeButton={false}
          render={<Link href="/servicios#curso" />}
        >
          Renovar ahora
        </Button>
      </div>
      <button
        type="button"
        aria-label="Cerrar aviso"
        className="shrink-0 text-amber-600/70 hover:text-amber-900"
        onClick={() => {
          sessionStorage.setItem(WARN_DISMISS_KEY, "1");
          setDismissed(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
};

/**
 * Full-screen paywall: blurs the ENTIRE app shell it wraps (sidebar
 * included, not just the page content) and centers a text-first,
 * landing-page-styled message + one payment button over it, viewport-fixed
 * so it's centered regardless of scroll or layout. Not dismissible.
 */
export const MembershipBlockScreen = ({
  neverPaid,
  children,
}: {
  neverPaid: boolean;
  children: React.ReactNode;
}) => (
  <div className="relative min-h-screen">
    <div aria-hidden className="pointer-events-none blur-[3px] brightness-97 select-none">
      {children}
    </div>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 px-6 backdrop-blur-sm">
      <div className="max-w-md text-center">
        <p className="font-[font2] text-[11px] tracking-[0.4em] text-muted-foreground uppercase">
          Portal del curso
        </p>
        <h2 className="mt-4 font-[font2] text-4xl leading-[0.95] tracking-tight uppercase lg:text-5xl">
          {neverPaid ? (
            <>
              Activa tu
              <br />
              membresía
            </>
          ) : (
            <>
              Tu acceso
              <br />
              está pausado
            </>
          )}
        </h2>
        <p className="mt-5 font-[font1] text-sm leading-relaxed text-muted-foreground lg:text-base">
          {neverPaid
            ? "Tu cuenta está lista — activa tu mensualidad para ver las clases en vivo, grabaciones y módulos del curso."
            : "Tu mensualidad lleva más de dos días vencida. Renueva para recuperar el acceso al material del curso."}
        </p>
        <Link
          href="/servicios#curso"
          className="mt-8 inline-flex items-center gap-3 rounded-full bg-primary px-8 py-4 font-[font2] text-sm tracking-[0.15em] text-primary-foreground uppercase transition-transform duration-300 hover:-translate-y-0.5"
        >
          Pagar ahora
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  </div>
);
