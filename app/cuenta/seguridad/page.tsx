import { auth } from "@/auth";

import CuentaSection from "@/app/components/cuenta/CuentaSection";
import ChangePasswordForm from "@/app/components/miembros/ChangePasswordForm";
import DeleteAccountRequest from "@/app/components/miembros/DeleteAccountRequest";
import ActiveSessionsTable from "@/app/components/shared/settings/ActiveSessionsTable";
import { listMemberSessions } from "@/lib/auth/member-sessions";
import { requirePortalContext } from "@/lib/lms/portal";

const Page = async () => {
  const { account } = await requirePortalContext();
  const session = await auth();
  const currentSessionId = session?.user?.sessionId ?? null;
  const sessions = await listMemberSessions(account.id);

  // Quien entró con Google no tiene contraseña que cambiar, sino una que
  // crear. Es la diferencia entre un formulario que parece roto y uno que
  // explica para qué sirve.
  const googleOnly = !account.passwordHash && Boolean(account.googleSub);

  return (
    <>
      <CuentaSection
        title="Contraseña"
        description={
          googleOnly
            ? "Entras con Google. Si creas una contraseña podrás entrar también con tu correo."
            : "La necesitas para entrar con tu correo."
        }
      >
        <ChangePasswordForm hasPassword={Boolean(account.passwordHash)} />
      </CuentaSection>

      <CuentaSection
        title="Dónde tienes la sesión abierta"
        description="Si no reconoces un dispositivo, ciérralo y cambia la contraseña."
      >
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
      </CuentaSection>

      <CuentaSection
        title="Eliminar la cuenta"
        description="Se borran tus datos y tu progreso. No se puede deshacer."
        tone="danger"
      >
        <DeleteAccountRequest />
      </CuentaSection>
    </>
  );
};

export default Page;
