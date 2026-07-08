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

const PortalLayout = async ({ children }: { children: ReactNode }) => {
  const member = await getMemberSession();
  if (!member) {
    redirect("/acceso");
  }

  const membership = await getMembershipForContact(member.contact.id);
  const lockState = getMembershipLockState(membership);

  return (
    <div className="portal-app">
      <PortalSidebar firstName={member.contact.firstName} lockState={lockState}>
        {children}
      </PortalSidebar>
    </div>
  );
};

export default PortalLayout;
