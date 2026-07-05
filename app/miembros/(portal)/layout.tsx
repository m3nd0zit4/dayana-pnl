import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMemberSession } from "@/lib/auth/member-session";
import PortalSidebar from "@/app/components/miembros/PortalSidebar";
import "../portal.css";

export const dynamic = "force-dynamic";

const PortalLayout = async ({ children }: { children: ReactNode }) => {
  const member = await getMemberSession();
  if (!member) {
    redirect("/acceso");
  }

  return (
    <div className="portal-app">
      <PortalSidebar firstName={member.contact.firstName} />
      <main className="min-h-screen px-4 pb-16 pt-6 lg:pl-[calc(var(--portal-sidebar-w)+2rem)] lg:pr-8 lg:pt-10">
        <div className="mx-auto w-full max-w-4xl">{children}</div>
      </main>
    </div>
  );
};

export default PortalLayout;
