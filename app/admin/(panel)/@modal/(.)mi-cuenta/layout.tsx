import SettingsModalShell from "@/app/components/shared/settings/SettingsModalShell";

const NAV_ITEMS = [
  { href: "/admin/mi-cuenta/general", label: "General" },
  { href: "/admin/mi-cuenta/cuenta", label: "Cuenta" },
  { href: "/admin/mi-cuenta/notificaciones", label: "Notificaciones" },
];

const MiCuentaModalLayout = ({ children }: { children: React.ReactNode }) => (
  <SettingsModalShell navItems={NAV_ITEMS}>{children}</SettingsModalShell>
);

export default MiCuentaModalLayout;
