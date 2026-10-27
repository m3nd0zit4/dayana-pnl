import type { Metadata } from "next";
import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import SettingsFrame from "@/app/components/shared/settings/SettingsFrame";
import SettingsNav from "@/app/components/shared/settings/SettingsNav";
import { settingsNavGroups } from "@/app/config/settings-hub";
import { getSettingsAudience } from "./owner-gate";

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
 *
 * En `/admin/ajustes` a secas el contenido es el índice (ancho completo); en
 * cada página concreta aparece el menú lateral (`SettingsFrame`).
 */
const AjustesLayout = async ({ children }: { children: React.ReactNode }) => {
  const { isOwner } = await getSettingsAudience();

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Ajustes"
        description={
          isOwner
            ? "Tu cuenta y la configuración global de la plataforma."
            : "Tu perfil, tu seguridad y tus notificaciones."
        }
      />
      <SettingsFrame nav={<SettingsNav groups={settingsNavGroups(isOwner)} />}>
        {children}
      </SettingsFrame>
    </CrmPageShell>
  );
};

export default AjustesLayout;
