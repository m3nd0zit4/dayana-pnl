import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMemberSession } from "@/lib/auth/member-session";
import {
  getMembershipForContact,
  getMembershipLockState,
} from "@/lib/lms/membership";
import PortalSidebar from "@/app/components/miembros/PortalSidebar";
import "../portal.css";

export const dynamic = "force-dynamic";

const PortalLayout = async ({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) => {
  const member = await getMemberSession();
  if (!member) {
    redirect("/acceso");
  }

  const membership = await getMembershipForContact(member.contact.id);
  const lockState = getMembershipLockState(membership);

  // Interruptor del stream SSE de la campana. Apagado ⇒ el feed se degrada a
  // sondeo periódico. Mismo criterio que el panel del CRM.
  const streamEnabled = process.env.NOTIFICATIONS_STREAM_ENABLED === "true";

  return (
    <div className="portal-app">
      <PortalSidebar
        firstName={member.contact.firstName}
        avatarUrl={member.contact.avatarUrl}
        lockState={lockState}
        streamEnabled={streamEnabled}
      >
        {children}
      </PortalSidebar>
      {modal}
    </div>
  );
};

export default PortalLayout;
