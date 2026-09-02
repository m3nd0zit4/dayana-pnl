"use client";

import type { ReactNode } from "react";
import type { MembershipLockState } from "@/lib/lms/membership";
import { MemberNotificationsProvider } from "./MemberNotificationBell";
import { MembershipWarningBanner } from "./MembershipLockOverlay";

/**
 * La carcasa de la plataforma.
 *
 * Ya no es una barra lateral: de todo lo que envolvía —panel de cursos,
 * listados de clases y módulos, la cuenta— sólo queda el reproductor, que trae
 * su propia cabecera y su propio índice de lecciones. Lo que este componente
 * aporta hoy son dos cosas que el reproductor no puede resolver solo: el
 * proveedor del feed de notificaciones y el aviso de que la membresía está a
 * punto de vencer.
 *
 * Tenía además una pantalla de bloqueo para toda la carcasa, que eximía a la
 * cuenta para que quien estuviera vencida pudiera llegar a renovar. Con la
 * cuenta fuera de `/miembros` y sólo el reproductor dentro, esa pantalla no
 * podía dispararse nunca: el muro de pago vive dentro del reproductor, junto a
 * la clase que se intenta ver.
 */
const PortalSidebar = ({
  lockState,
  streamEnabled,
  children,
}: {
  lockState: MembershipLockState;
  streamEnabled: boolean;
  children: ReactNode;
}) => (
  <MemberNotificationsProvider streamEnabled={streamEnabled}>
    <div className="min-h-screen bg-background">
      {lockState.kind === "warning" && (
        <div className="px-4 pt-4 lg:px-8">
          <MembershipWarningBanner
            daysUntilBlocked={lockState.daysUntilBlocked}
          />
        </div>
      )}
      {children}
    </div>
  </MemberNotificationsProvider>
);

export default PortalSidebar;
