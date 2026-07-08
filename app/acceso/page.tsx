import type { Metadata } from "next";
import { Suspense } from "react";
import { isGoogleAuthEnabled } from "@/auth";
import { BRAND } from "@/lib/contact";
import MemberAuthShell from "@/app/components/miembros/MemberAuthShell";
import MemberSignInForm from "@/app/components/miembros/MemberSignInForm";

export const metadata: Metadata = {
  title: `Acceso — ${BRAND.name}`,
  description:
    "Un solo acceso: miembros del curso entran a su portal y el equipo al CRM.",
  robots: { index: false, follow: false },
};

/**
 * Punto de entrada único. El backend decide por email: staff → /admin,
 * miembros → /miembros (el proxy redirige según el rol de la sesión).
 */
const Page = () => (
  <MemberAuthShell
    title="Entrar"
    description="Un solo acceso: te llevamos a tus clases o al panel del equipo según tu cuenta."
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
