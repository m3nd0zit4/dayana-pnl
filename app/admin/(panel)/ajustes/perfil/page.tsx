import { getStaffSession } from "@/lib/auth/staff-session";
import { redirect } from "next/navigation";
import StaffProfileForm from "@/app/components/admin/crm/StaffProfileForm";
import AvatarUploadField from "@/app/components/shared/settings/AvatarUploadField";
import { Card, CardContent } from "@/app/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Envoltorio delgado a propósito: toda la UI y el estado viven en
 * `StaffProfileForm`.
 *
 * El comentario anterior decía que esta página estaba espejada por una ruta
 * interceptora `@modal/(.)ajustes/perfil`. No existía: bajo `app/admin` no hay
 * ningún interceptor, y el slot `@modal` que había era inerte (el layout ni
 * siquiera lo recibía como prop). Quien tiene interceptores de verdad es el
 * portal de miembros, en `app/miembros/(portal)/@modal/(.)cuenta/*`.
 */
const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  // Mismo envoltorio que el resto de páginas de ajustes (`space-y-6` + tarjetas
  // dentro): así todas se ven igual y no hay unas «en página» y otras «en ficha».
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
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
    </div>
  );
};

export default Page;
