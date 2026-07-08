import type { Metadata } from "next";
import { isGoogleAuthEnabled } from "@/auth";
import { BRAND } from "@/lib/contact";
import { peekMemberAuthToken } from "@/lib/auth/member-tokens";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import MemberSignupForm from "@/app/components/miembros/MemberSignupForm";
import RequestAccessForm from "@/app/components/miembros/RequestAccessForm";
import SetPasswordForm from "@/app/components/miembros/SetPasswordForm";

export const metadata: Metadata = {
  title: `Crea tu cuenta — ${BRAND.name}`,
  description: "Crea tu cuenta del portal de miembros.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ token?: string }>;
};

const Page = async ({ searchParams }: PageProps) => {
  const { token } = await searchParams;

  if (token) {
    const peek = await peekMemberAuthToken(token);
    if (peek) {
      return (
        <MemberAuthShell
          title="Crea tu contraseña"
          description="Con ella entrarás al portal para ver tus clases, grabaciones y módulos."
        >
          <SetPasswordForm token={token} email={peek.email} />
        </MemberAuthShell>
      );
    }

    return (
      <MemberAuthShell
        title="Enlace vencido"
        description="Este enlace ya no es válido. Escribe tu correo y te enviamos uno nuevo."
      >
        <RequestAccessForm buttonLabel="Enviarme un enlace nuevo" />
      </MemberAuthShell>
    );
  }

  return (
    <MemberAuthShell
      title="Crea tu cuenta"
      description="Entra de una vez — no necesitas esperar ningún correo. Tu acceso al material del curso se activa cuando tu pago quede al día."
    >
      <MemberSignupForm googleEnabled={isGoogleAuthEnabled()} />
    </MemberAuthShell>
  );
};

export default Page;
