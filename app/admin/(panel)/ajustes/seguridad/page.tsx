import { redirect } from "next/navigation";
import { getStaffSession, getCurrentSessionId } from "@/lib/auth/staff-session";
import { listStaffSessions } from "@/lib/auth/staff-sessions";
import ActiveSessionsTable from "@/app/components/shared/settings/ActiveSessionsTable";
import { Card, CardContent } from "@/app/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Envoltorio delgado a propósito: esta página está espejada por la ruta
 * interceptora `@modal/(.)ajustes/seguridad`, que solo reexporta este default.
 */
const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  const [sessions, currentSessionId] = await Promise.all([
    listStaffSessions(staff.id),
    getCurrentSessionId(),
  ]);

  return (
    <Card>
      <CardContent>
        <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
          Sesiones activas
        </h2>
        <div className="mt-4">
          <ActiveSessionsTable
            sessions={sessions.map((s) => ({
              id: s.id,
              deviceLabel: s.deviceLabel,
              ipAddress: s.ipAddress,
              lastSeenAt: s.lastSeenAt.toISOString(),
              createdAt: s.createdAt.toISOString(),
            }))}
            currentSessionId={currentSessionId}
            revokeUrlBase="/api/admin/staff/me/sesiones"
            revokeAllUrl="/api/admin/staff/me/sesiones/revocar-todas"
            signInUrl="/acceso"
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default Page;
