import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/staff-session";
import { resolveStaffPreferences } from "@/lib/notifications/platform/preferences";
import StaffNotificationPreferencesForm from "@/app/components/shared/settings/StaffNotificationPreferencesForm";

export const dynamic = "force-dynamic";

/**
 * Envoltorio delgado a propósito: toda la UI y el estado viven en
 * `StaffNotificationPreferencesForm`.
 *
 * No hay ninguna ruta interceptora que espeje esta página, pese a lo que decía
 * el comentario anterior — ver la nota en `ajustes/perfil/page.tsx`.
 */
const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  const preferences = await resolveStaffPreferences(staff.id, staff.role);

  return (
    <StaffNotificationPreferencesForm
      initialPreferences={preferences.map(({ eventType, inApp, email }) => ({
        eventType,
        inApp,
        email,
      }))}
      initialNotifyEmail={staff.notifyEmail}
    />
  );
};

export default Page;
