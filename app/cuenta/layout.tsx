import type { Metadata } from "next";
import type { ReactNode } from "react";

import Footer from "@/app/components/home/Footer";
import CuentaShell from "@/app/components/cuenta/CuentaShell";
import { requirePortalContext } from "@/lib/lms/portal";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Tu cuenta — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

/**
 * La cuenta salió de `/miembros`.
 *
 * Vivía dentro del portal del curso, así que sólo se llegaba a ella «desde
 * dentro» y aparecía con dos controles de identidad a la vez: el avatar de la
 * barra lateral del portal y el de la cabecera del sitio. No es una sección
 * del curso —se gestiona el perfil, la contraseña y los pagos—, así que ahora
 * es una página del sitio, con la cabecera de siempre y un solo avatar arriba
 * a la derecha.
 *
 * `requirePortalContext` sigue siendo el guardián: exige un `MemberAccount`
 * real y rebota a `/acceso` sin él. El staff no tiene uno —está prohibido a
 * propósito en lib/crm/member-accounts.ts—, y por eso su menú apunta a
 * `/admin/ajustes/perfil` y no aquí.
 */
const CuentaLayout = async ({ children }: { children: ReactNode }) => {
  const { contact } = await requirePortalContext();

  return (
    <>
      <div className="bg-hero-paper text-ink">
        <CuentaShell firstName={contact.firstName}>{children}</CuentaShell>
      </div>
      <Footer />
    </>
  );
};

export default CuentaLayout;
