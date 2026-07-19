import type { Metadata } from "next";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import SettingsNav from "@/app/components/shared/settings/SettingsNav";

export const metadata: Metadata = {
  title: "Mi cuenta — CRM",
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: "/admin/mi-cuenta/general", label: "General" },
  { href: "/admin/mi-cuenta/cuenta", label: "Cuenta" },
  { href: "/admin/mi-cuenta/notificaciones", label: "Notificaciones" },
];

const MiCuentaLayout = ({ children }: { children: React.ReactNode }) => (
  <CrmPageShell>
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mi cuenta</h1>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        <SettingsNav items={NAV_ITEMS} />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  </CrmPageShell>
);

export default MiCuentaLayout;
