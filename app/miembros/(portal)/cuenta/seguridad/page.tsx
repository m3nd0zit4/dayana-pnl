import { auth } from "@/auth";
import { requirePortalContext } from "@/lib/lms/portal";
import { listMemberSessions } from "@/lib/auth/member-sessions";
import ChangePasswordForm from "@/app/components/miembros/ChangePasswordForm";
import DeleteAccountRequest from "@/app/components/miembros/DeleteAccountRequest";
import ActiveSessionsTable from "@/app/components/shared/settings/ActiveSessionsTable";
import { Card, CardContent } from "@/app/components/ui/card";

const Page = async () => {
  const { account } = await requirePortalContext();
  const session = await auth();
  const currentSessionId = session?.user?.sessionId ?? null;
  const sessions = await listMemberSessions(account.id);

  return (
    <div className="space-y-6">
      <Card className="max-w-xl">
        <CardContent>
          <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Contraseña
          </h2>
          {!account.passwordHash && account.googleSub ? (
            <p className="mt-3 text-sm leading-relaxed">
              Entras con Google. Si quieres, crea también una contraseña para
              poder entrar con tu correo.
            </p>
          ) : null}
          <div className="mt-4">
            <ChangePasswordForm hasPassword={Boolean(account.passwordHash)} />
          </div>
        </CardContent>
      </Card>

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
              revokeUrlBase="/api/miembros/cuenta/sesiones"
              revokeAllUrl="/api/miembros/cuenta/sesiones/revocar-todas"
              signInUrl="/acceso"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-xl border-destructive/30">
        <CardContent>
          <h2 className="text-[11px] text-muted-foreground uppercase tracking-wide">
            Eliminar cuenta
          </h2>
          <div className="mt-4">
            <DeleteAccountRequest />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Page;
