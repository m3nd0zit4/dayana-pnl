import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMemberSession } from "@/lib/auth/member-session";
import PortalNav from "@/app/components/miembros/PortalNav";

export const dynamic = "force-dynamic";

const PortalLayout = async ({ children }: { children: ReactNode }) => {
  const member = await getMemberSession();
  if (!member) {
    redirect("/acceso");
  }

  return (
    <div className="relative min-h-screen bg-black text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: [
            "radial-gradient(60% 40% at 15% 0%, rgba(236,227,212,0.08), transparent 60%)",
            "radial-gradient(50% 45% at 90% 100%, rgba(237,195,177,0.10), transparent 65%)",
          ].join(","),
        }}
      />
      <div className="relative">
        <PortalNav firstName={member.contact.firstName} />
        <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
};

export default PortalLayout;
