import TeamPageClient from "@/app/components/admin/crm/TeamPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { canManageTeam, listStaffUsers } from "@/lib/crm/staff";

export const dynamic = "force-dynamic";

const PREVIEW_TEAM = [
  {
    id: "st1",
    displayName: "Dayana Beltrán",
    email: "contacto@dayanabeltran.com",
    role: "OWNER",
  },
];

const TeamPage = async () => {
  const preview = isCrmUiPreview();
  const current = preview ? null : await getStaffSession();
  let team = PREVIEW_TEAM;
  let canManage = false;

  if (!preview && current) {
    canManage = canManageTeam(current.role);
    try {
      team = await listStaffUsers();
    } catch {
      team = [];
    }
  } else if (preview) {
    canManage = true;
  }

  return (
    <TeamPageClient
      team={team}
      currentId={current?.id}
      canManage={canManage}
      preview={preview}
    />
  );
};

export default TeamPage;
