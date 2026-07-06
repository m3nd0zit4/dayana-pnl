import { redirect } from "next/navigation";
import CrmProvider from "@/app/components/admin/crm/CrmProvider";
import CrmShell from "@/app/components/admin/crm/CrmShell";
import type { StaffRole } from "@prisma/client";
import { isAiConfigured } from "@/lib/ai/gemini";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

const PanelLayout = async ({ children }: { children: React.ReactNode }) => {
  const preview = isCrmUiPreview();
  const staff = preview ? null : await getStaffSession();

  if (!preview && !staff) {
    redirect("/acceso");
  }

  const displayName = staff?.displayName ?? "Vista previa";
  const role: StaffRole | "PREVIEW" = staff?.role ?? "PREVIEW";

  const aiEnabled = isAiConfigured();

  return (
    <CrmProvider role={role} preview={preview} aiEnabled={aiEnabled}>
      <CrmShell displayName={displayName} role={role} preview={preview}>
        {children}
      </CrmShell>
    </CrmProvider>
  );
};

export default PanelLayout;
