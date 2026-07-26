import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import SettingsNav from "@/app/components/shared/settings/SettingsNav";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";

export const metadata: Metadata = {
  title: "Ajustes del sitio — CRM",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const NAV_ITEMS = [
  { href: "/admin/ajustes/general", label: "General" },
  { href: "/admin/ajustes/notificaciones", label: "Notificaciones" },
  { href: "/admin/ajustes/integraciones", label: "Integraciones" },
  { href: "/admin/ajustes/registro", label: "Registro de envíos" },
];

/**
 * Ajustes del sitio: solo OWNER.
 *
 * La comprobación se hace aquí y no solo en el menú porque el menú es una
 * sugerencia — la URL se puede escribir a mano. Cada endpoint que hay debajo
 * vuelve a exigir OWNER por su cuenta (`requireOwnerStaff`); esto es la puerta
 * de la UI, no la única defensa.
 */
const AjustesLayout = async ({ children }: { children: React.ReactNode }) => {
  const preview = isCrmUiPreview();
  const staff = preview ? null : await getStaffSession();

  if (!preview) {
    if (!staff) redirect("/acceso");
    if (staff.role !== "OWNER") redirect("/admin");
  }

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Ajustes del sitio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configuración global de la plataforma. Solo el rol OWNER puede
            verla y modificarla.
          </p>
        </div>
        <div className="flex flex-col gap-6 sm:flex-row">
          <SettingsNav items={NAV_ITEMS} />
          <div className="min-w-0 flex-1 space-y-6">{children}</div>
        </div>
      </div>
    </CrmPageShell>
  );
};

export default AjustesLayout;
