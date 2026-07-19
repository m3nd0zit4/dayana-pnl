import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/contact";
import { getMemberSession } from "@/lib/auth/member-session";
import { hasRealContactPhone } from "@/lib/crm/contact-phone";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import CompleteProfileForm from "@/app/components/miembros/CompleteProfileForm";

export const metadata: Metadata = {
  title: `Completa tu perfil — ${BRAND.name}`,
  description: "Un último paso antes de entrar a tu cuenta.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

/** Same-site relative paths only — open-redirect guard. */
const safeCallbackUrl = (value: string | undefined): string | null =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : null;

const Page = async ({ searchParams }: PageProps) => {
  const { callbackUrl } = await searchParams;
  const destination = safeCallbackUrl(callbackUrl) ?? "/miembros";

  const member = await getMemberSession();
  if (!member) {
    redirect(`/acceso?callbackUrl=${encodeURIComponent(destination)}`);
  }

  // Already complete (e.g. finished this in another tab) — don't show it twice.
  if (hasRealContactPhone(member.contact.phoneE164)) {
    redirect(destination);
  }

  return (
    <MemberAuthShell
      title="Completa tu perfil"
      description="Nos falta tu WhatsApp para poder confirmarte pagos y avisos de tus clases."
    >
      <CompleteProfileForm
        firstName={member.contact.firstName}
        lastName={member.contact.lastName ?? ""}
        defaultCountry={member.contact.countryIso ?? "CO"}
        callbackUrl={destination}
      />
    </MemberAuthShell>
  );
};

export default Page;
