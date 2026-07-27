import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import SettingsNav from "@/app/components/shared/settings/SettingsNav";
import SettingsRelatedLinks from "@/app/components/shared/settings/SettingsRelatedLinks";
import {
  personalSettingsGroup,
  siteSettingsGroups,
} from "@/app/config/settings-nav";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { canManageTeam } from "@/lib/crm/staff-permissions";

export const metadata: Metadata = {
  title: "Ajustes — CRM",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Centro de ajustes: personal y del sitio en un solo sitio.
 *
 * El layout no cierra la puerta a nadie porque el grupo «Mi cuenta» es para
 * cualquier rol; lo que hace es no pintar los grupos de OWNER a quien no lo es
 * — un enlace visible que rebota confunde más de lo que ayuda. El cierre de
 * verdad lo pone cada página del sitio con `requireOwnerSettings`.
 */
const AjustesLayout = async ({ children }: { children: React.ReactNode }) => {
  const preview = isCrmUiPreview();
  const staff = preview ? null : await getStaffSession();

  if (!preview && !staff) redirect("/acceso");

  const isOwner = preview || (staff != null && canManageTeam(staff.role));
  const groups = isOwner
    ? [personalSettingsGroup, ...siteSettingsGroups]
    : [personalSettingsGroup];

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? "Tu cuenta y la configuración global de la plataforma."
              : "Tu perfil, tu seguridad y tus notificaciones."}
          </p>
        </div>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex shrink-0 flex-col gap-5 sm:w-52">
            <SettingsNav groups={groups} />
            <SettingsRelatedLinks />
          </div>
          <div className="min-w-0 flex-1 space-y-6">{children}</div>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default AjustesLayout;
