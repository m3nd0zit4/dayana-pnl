"use client";

import Link from "next/link";
import { useState } from "react";
import { Lock, TriangleAlert, X } from "lucide-react";
import type { MembershipLockState } from "@/lib/lms/membership";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

const WARN_DISMISS_KEY = "portal-membership-warning-dismissed";

type Props = {
  lockState: MembershipLockState;
  /** True on /miembros/cuenta — never blur/block the page that lets you pay. */
  bypass: boolean;
  children: React.ReactNode;
};

/**
 * A branded paywall over the portal: the real content stays mounted and
 * visible underneath (blurred), never a blank/loading page.
 * - "warning" (still inside the grace window): dismissible for the
 *   session, background stays interactive.
 * - "blocked" (grace expired, or never had access to begin with): not
 *   dismissible, background is non-interactive.
 */
const MembershipLockOverlay = ({ lockState, bypass, children }: Props) => {
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      sessionStorage.getItem(WARN_DISMISS_KEY) === "1"
  );

  if (bypass || lockState.kind === "none") {
    return <>{children}</>;
  }

  if (lockState.kind === "warning") {
    return (
      <>
        {!dismissed && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0 flex-1 text-sm text-amber-900">
              <p className="font-medium">
                Tu mensualidad venció.{" "}
                {lockState.daysUntilBlocked > 0
                  ? `Tienes ${lockState.daysUntilBlocked} día${lockState.daysUntilBlocked === 1 ? "" : "s"} más antes de perder el acceso.`
                  : "Hoy es tu último día de acceso."}
              </p>
              <Button
                size="sm"
                className="mt-2.5"
                nativeButton={false}
                render={<Link href="/miembros/cuenta" />}
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
        )}
        {children}
      </>
    );
  }

  const { neverPaid } = lockState;

  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none min-h-[60vh] blur-md brightness-95 select-none">
        {children}
      </div>
      <div className="absolute inset-0 -mx-4 -mt-6 flex items-start justify-center bg-background/70 px-4 pt-10 backdrop-blur-sm lg:-mx-8 lg:-mt-10">
        <Card className="w-full max-w-sm border-primary/20 shadow-lg">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent/40 text-primary">
              <Lock className="size-5" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">
              {neverPaid ? "Activa tu membresía" : "Tu acceso está pausado"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {neverPaid
                ? "Tu cuenta está lista — activa tu mensualidad para ver las clases en vivo, grabaciones y módulos del curso."
                : "Tu mensualidad lleva más de dos días vencida. Renueva para recuperar el acceso al material del curso."}
            </p>
            <Button
              className="mt-2 w-full"
              nativeButton={false}
              render={<Link href="/miembros/cuenta" />}
            >
              {neverPaid ? "Activar membresía" : "Renovar mi mes"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MembershipLockOverlay;
