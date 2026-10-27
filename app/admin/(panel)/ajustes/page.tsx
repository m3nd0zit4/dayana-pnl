import SettingsHub from "@/app/components/shared/settings/SettingsHub";
import { settingsHubGroups } from "@/app/config/settings-hub";
import { getSettingsAudience } from "./owner-gate";

/**
 * El índice de los ajustes: todo agrupado por para qué sirve, con buscador.
 *
 * Antes esta ruta redirigía a «Perfil», que es lo único que ve cualquier rol.
 * Quien administra el equipo no tenía un sitio donde ver de un vistazo qué se
 * puede configurar. Cada grupo con `ownerOnly` se pinta solo a OWNER; las
 * páginas de debajo siguen cerrando la puerta por su cuenta.
 */
const Page = async () => {
  const { isOwner } = await getSettingsAudience();
  const groups = settingsHubGroups.filter((group) => !group.ownerOnly || isOwner);

  return <SettingsHub groups={groups} isOwner={isOwner} />;
};

export default Page;
