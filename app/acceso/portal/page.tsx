import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LayoutDashboard, BookOpen } from "lucide-react";
import { BRAND } from "@/lib/contact";
import { getStaffSession } from "@/lib/auth/staff-session";
import { canManageTeam } from "@/lib/crm/staff-permissions";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";

export const metadata: Metadata = {
  title: `Elige a dónde entrar — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * OWNER-only landing shown right after login: her account has both CRM and
 * course-portal access (lib/auth/portal-viewer.ts), so instead of silently
 * picking one, she chooses. Reached from proxy.ts's isSignIn branch and
 * from MemberSignInForm's post-login redirect when no explicit callbackUrl
 * was requested. Anyone else lands here only by guessing the URL and gets
 * bounced to wherever their real session already goes.
 */
const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");
  if (!canManageTeam(staff.role)) redirect("/admin");

  return (
    <MemberAuthShell
      title="¿A dónde quieres entrar?"
      description="Tu cuenta tiene acceso al CRM y al portal del curso."
    >
      <div className="space-y-3">
        <a
          href="/admin"
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/12 bg-white px-4 py-3.5 font-[font1] text-sm text-[#141118] transition-colors hover:border-black/25 hover:bg-black/[0.03]"
        >
          <LayoutDashboard className="size-4 text-linen/70" />
          Entrar al CRM
        </a>
        <a
          href="/miembros"
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-black/12 bg-white px-4 py-3.5 font-[font1] text-sm text-[#141118] transition-colors hover:border-black/25 hover:bg-black/[0.03]"
        >
          <BookOpen className="size-4 text-linen/70" />
          Entrar al portal del curso
        </a>
      </div>
    </MemberAuthShell>
  );
};

export default Page;
