import type { Metadata } from "next";
import { isGoogleAuthEnabled } from "@/auth";
import { BRAND } from "@/lib/contact";
import { peekMemberAuthToken } from "@/lib/auth/member-tokens";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import OnboardingWizard from "@/app/components/miembros/OnboardingWizard";
import RequestAccessForm from "@/app/components/miembros/RequestAccessForm";
import SetPasswordForm from "@/app/components/miembros/SetPasswordForm";

export const metadata: Metadata = {
  title: `Crea tu cuenta — ${BRAND.name}`,
  description: "Crea tu cuenta del portal de miembros.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ token?: string; callbackUrl?: string }>;
};

/** Same-site relative paths only — open-redirect guard for the emailed link. */
const safeCallbackUrl = (value: string | undefined): string | null =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : null;

const Page = async ({ searchParams }: PageProps) => {
  const { token, callbackUrl } = await searchParams;

  if (token) {
    const peek = await peekMemberAuthToken(token);
    if (peek) {
      return (
        <MemberAuthShell
          title="Crea tu contraseña"
          description="Con ella entrarás a tu cuenta y a tus compras."
        >
          <SetPasswordForm
            token={token}
            email={peek.email}
            callbackUrl={safeCallbackUrl(callbackUrl)}
          />
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
      description="Cuatro pasos y entras directo — sin esperar correos."
    >
      <OnboardingWizard
        googleEnabled={isGoogleAuthEnabled()}
        callbackUrl={safeCallbackUrl(callbackUrl) ?? undefined}
      />
    </MemberAuthShell>
  );
};

export default Page;
