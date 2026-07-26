import { redirect } from "next/navigation";
import CrmProvider from "@/app/components/admin/crm/CrmProvider";
import CrmShell from "@/app/components/admin/crm/CrmShell";
import type { StaffRole } from "@prisma/client";
import { isAgentEnabled } from "@/lib/agent/is-agent-enabled";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

const PanelLayout = async ({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) => {
  const preview = isCrmUiPreview();
  const staff = preview ? null : await getStaffSession();

  if (!preview && !staff) {
    redirect("/acceso");
  }

  const displayName = staff?.displayName ?? "Vista previa";
  const role: StaffRole | "PREVIEW" = staff?.role ?? "PREVIEW";
  const avatarUrl = staff?.avatarUrl ?? null;

  // Phase 1: agent panel is OWNER-only, mirroring `agent/channels/eve.ts`'s auth gate.
  const agentEnabled = isAgentEnabled() && role === "OWNER";

  // Interruptor del stream SSE de la campana. Apagado ⇒ el feed se degrada a
  // sondeo periódico. En vista previa nunca hay sesión, así que nunca hay stream.
  const streamEnabled =
    !preview && process.env.NOTIFICATIONS_STREAM_ENABLED === "true";

  return (
    <CrmProvider
      role={role}
      preview={preview}
      agentEnabled={agentEnabled}
      streamEnabled={streamEnabled}
    >
      <CrmShell
        displayName={displayName}
        role={role}
        avatarUrl={avatarUrl}
        preview={preview}
      >
        {children}
        {modal}
      </CrmShell>
    </CrmProvider>
  );
};

export default PanelLayout;
