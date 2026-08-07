import { redirect } from "next/navigation";
import { getStaffSession, getCurrentSessionId } from "@/lib/auth/staff-session";
import { listStaffSessions } from "@/lib/auth/staff-sessions";
import ActiveSessionsTable from "@/app/components/shared/settings/ActiveSessionsTable";
import { Card, CardContent } from "@/app/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Envoltorio delgado a propósito: la UI vive en `ActiveSessionsTable`.
 *
 * No hay ninguna ruta interceptora que espeje esta página, pese a lo que decía
 * el comentario anterior — ver la nota en `ajustes/perfil/page.tsx`.
 */
const Page = async () => {
  const staff = await getStaffSession();
  if (!staff) redirect("/acceso");

  const [sessions, currentSessionId] = await Promise.all([
    listStaffSessions(staff.id),
    getCurrentSessionId(),
  ]);

  // Mismo envoltorio que el resto de páginas de ajustes.
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Sesiones activas
          </h2>
          <div>
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
    </div>
  );
};

export default Page;
