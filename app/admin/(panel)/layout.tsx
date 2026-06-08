import { redirect } from "next/navigation";
import AdminPreviewBanner from "@/app/components/admin/AdminPreviewBanner";
import CrmLogo from "@/app/components/admin/crm/CrmLogo";
import CrmGuidePanel from "@/app/components/admin/crm/CrmGuidePanel";
import CrmMenu from "@/app/components/admin/crm/CrmMenu";
import CrmNavBar from "@/app/components/admin/crm/CrmNavBar";
import CrmProvider from "@/app/components/admin/crm/CrmProvider";
import type { StaffRole } from "@prisma/client";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

const PanelLayout = async ({ children }: { children: React.ReactNode }) => {
  const preview = isCrmUiPreview();
  const staff = preview ? null : await getStaffSession();

  if (!preview && !staff) {
    redirect("/admin/sign-in");
  }

  const displayName = staff?.displayName ?? "Vista previa";
  const role: StaffRole | "PREVIEW" = staff?.role ?? "PREVIEW";

  return (
    <CrmProvider role={role} preview={preview}>
    <div className="flex h-screen min-h-0">
      <aside className="crm-sidebar-scroll crm-sidebar-brand crm-glass-panel crm-no-scrollbar flex h-full w-[14%] min-w-20 shrink-0 flex-col overflow-y-auto border-r border-[var(--crm-border)] p-4 lg:min-w-[13rem] lg:w-[16%] xl:w-[14%] lg:pb-4">
        <CrmLogo />
        <CrmMenu />
        <CrmGuidePanel />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <CrmNavBar displayName={displayName} role={role} preview={preview} />
        <main className="flex flex-1 flex-col pb-5">
          {preview && (
            <div className="px-5 pt-4 md:px-6">
              <AdminPreviewBanner />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
    </CrmProvider>
  );
};

export default PanelLayout;
