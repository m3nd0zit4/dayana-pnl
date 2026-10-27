import { redirect } from "next/navigation";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { canManageTeam } from "@/lib/crm/staff-permissions";

/**
 * Quién mira los ajustes, para decidir qué grupos se pintan (el índice y el
 * menú lateral). No cierra la puerta a nadie: «Mi cuenta» es de cualquier rol.
 * Sin sesión manda a entrar.
 */
export const getSettingsAudience = async (): Promise<{ isOwner: boolean }> => {
  if (isCrmUiPreview()) return { isOwner: true };

  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");
  return { isOwner: canManageTeam(staff.role) };
};

/**
 * Puerta de UI de las páginas de sitio dentro de `/admin/ajustes`.
 *
 * El layout ya no puede exigir OWNER para toda la rama, porque bajo la misma
 * ruta cuelgan ahora los ajustes personales, que son de cualquier rol. Así que
 * la comprobación baja a cada página del sitio. Sigue sin ser la única defensa:
 * cada endpoint de debajo vuelve a exigir OWNER por su cuenta
 * (`requireOwnerStaff`). Esto solo evita enseñar la pantalla.
 */
export const requireOwnerSettings = async () => {
  if (isCrmUiPreview()) return;

  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");
  if (!canManageTeam(staff.role)) redirect("/admin/ajustes/perfil");
};
