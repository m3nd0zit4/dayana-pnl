import SettingsModalShell from "@/app/components/shared/settings/SettingsModalShell";
import { personalSettingsGroup } from "@/app/config/settings-nav";

/**
 * Solo se espejan las tres páginas personales. Las del sitio son destinos con
 * tablas anchas y no caben en una tarjeta: al no tener espejo, un enlace hacia
 * ellas cierra el overlay y navega a la página completa, que es lo que se
 * quiere.
 */
const AjustesModalLayout = ({ children }: { children: React.ReactNode }) => (
  <SettingsModalShell navGroups={[personalSettingsGroup]}>
    {children}
  </SettingsModalShell>
);

export default AjustesModalLayout;
