import { getStaffSession } from "@/lib/auth/staff-session";
import { redirect } from "next/navigation";
import StaffProfileForm from "@/app/components/admin/crm/StaffProfileForm";
import AvatarUploadField from "@/app/components/shared/settings/AvatarUploadField";
import { Card, CardContent } from "@/app/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Envoltorio delgado a propósito: esta página está espejada por la ruta
 * interceptora `@modal/(.)ajustes/perfil`, que solo reexporta este default.
 */
const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  return (
    <Card>
      <CardContent className="space-y-6">
        <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Mi perfil
        </h2>
        <AvatarUploadField
          uploadUrl="/api/admin/staff/me/avatar"
          name={staff.displayName}
          initialAvatarUrl={staff.avatarUrl}
        />
        <div className="max-w-xl">
          <StaffProfileForm initialDisplayName={staff.displayName} />
        </div>
      </CardContent>
    </Card>
  );
};

export default Page;
