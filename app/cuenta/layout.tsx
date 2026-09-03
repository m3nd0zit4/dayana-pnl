import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import Footer from "@/app/components/home/Footer";
import CuentaShell from "@/app/components/cuenta/CuentaShell";
import { getStaffSession } from "@/lib/auth/staff-session";
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
  /**
   * El staff no tiene `MemberAccount`, así que aquí no hay nada que
   * enseñarle: su perfil vive en el CRM. Se le manda allí directamente en vez
   * de dejar que `requirePortalContext` lo eche a `/acceso`, que al ver una
   * sesión de staff abierta lo lleva a «elige CRM o portal» — una pregunta que
   * no responde a lo que venía a hacer.
   */
  const staff = await getStaffSession().catch(() => null);
  if (staff) redirect("/admin/ajustes/perfil");

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
