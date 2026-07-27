import type { Metadata } from "next";
import { BRAND } from "@/lib/contact";
import SettingsNav from "@/app/components/shared/settings/SettingsNav";

export const metadata: Metadata = {
  title: `Mi cuenta — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const NAV_ITEMS = [
  { href: "/miembros/cuenta/general", label: "General" },
  { href: "/miembros/cuenta/seguridad", label: "Seguridad" },
  { href: "/miembros/cuenta/notificaciones", label: "Notificaciones" },
  { href: "/miembros/cuenta/facturacion", label: "Facturación" },
];

const CuentaLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
        Mi cuenta
      </h1>
    </div>
    <div className="flex flex-col gap-6 sm:flex-row">
      <SettingsNav groups={[{ items: NAV_ITEMS }]} />
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </div>
  </div>
);

export default CuentaLayout;
