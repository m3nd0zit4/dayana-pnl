import type { Metadata } from "next";
import { Suspense } from "react";
import { isGoogleAuthEnabled } from "@/auth";
import { BRAND } from "@/lib/contact";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import MemberSignInForm from "@/app/components/miembros/MemberSignInForm";

export const metadata: Metadata = {
  title: `Acceso miembros — ${BRAND.name}`,
  description: "Entra al portal de miembros: clases en vivo, grabaciones y módulos.",
  robots: { index: false, follow: false },
};

const Page = () => (
  <MemberAuthShell
    eyebrow="Portal de miembros"
    title="Bienvenida de vuelta"
    description="Tus clases en vivo, grabaciones y módulos del curso, en un solo lugar."
  >
    <Suspense
      fallback={
        <p className="animate-pulse font-[font1] text-sm text-white/50">
          Cargando acceso…
        </p>
      }
    >
      <MemberSignInForm googleEnabled={isGoogleAuthEnabled()} />
    </Suspense>
  </MemberAuthShell>
);

export default Page;
