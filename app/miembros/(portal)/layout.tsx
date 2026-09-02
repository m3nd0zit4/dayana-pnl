import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getPortalViewer } from "@/lib/auth/portal-viewer";
import {
  getMembershipForContact,
  getMembershipLockState,
} from "@/lib/lms/membership";
import PortalSidebar from "@/app/components/miembros/PortalSidebar";
import "../portal.css";

export const dynamic = "force-dynamic";

/**
 * La carcasa de la plataforma: lo único que queda aquí es el reproductor.
 *
 * Tenía además una ranura `@modal` que interceptaba las rutas de la cuenta
 * para abrirlas en diálogo sin salir del portal. La cuenta se mudó a `/cuenta`
 * —fuera del portal, con la cabecera del sitio— y con ella se fue la única
 * ranura que existía.
 */
const PortalLayout = async ({ children }: { children: ReactNode }) => {
  const member = await getPortalViewer();
  if (!member) {
    redirect("/acceso");
  }

  const membership = await getMembershipForContact(member.contact.id, {
    isOwner: member.isOwner,
  });
  const lockState = getMembershipLockState(membership);

  // Interruptor del stream SSE de la campana. Apagado ⇒ el feed se degrada a
  // sondeo periódico. Mismo criterio que el panel del CRM.
  const streamEnabled = process.env.NOTIFICATIONS_STREAM_ENABLED === "true";

  return (
    <div className="portal-app">
      <PortalSidebar lockState={lockState} streamEnabled={streamEnabled}>
        {children}
      </PortalSidebar>
    </div>
  );
};

export default PortalLayout;
