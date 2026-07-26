import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/staff-session";
import { resolveStaffPreferences } from "@/lib/notifications/platform/preferences";
import StaffNotificationPreferencesForm from "@/app/components/shared/settings/StaffNotificationPreferencesForm";

export const dynamic = "force-dynamic";

/**
 * Envoltorio delgado a propósito: esta página está espejada por la ruta
 * interceptora `@modal/(.)mi-cuenta/notificaciones`, que solo reexporta este
 * default. Toda la UI y el estado viven en `StaffNotificationPreferencesForm`,
 * así que el modal y la página completa renderizan lo mismo sin duplicar nada.
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
