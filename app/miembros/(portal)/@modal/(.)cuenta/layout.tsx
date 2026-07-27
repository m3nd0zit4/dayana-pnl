import SettingsModalShell from "@/app/components/shared/settings/SettingsModalShell";

const NAV_ITEMS = [
  { href: "/miembros/cuenta/general", label: "General" },
  { href: "/miembros/cuenta/seguridad", label: "Seguridad" },
  { href: "/miembros/cuenta/notificaciones", label: "Notificaciones" },
  { href: "/miembros/cuenta/facturacion", label: "Facturación" },
];

const CuentaModalLayout = ({ children }: { children: React.ReactNode }) => (
  <SettingsModalShell navGroups={[{ items: NAV_ITEMS }]}>
    {children}
  </SettingsModalShell>
);

export default CuentaModalLayout;
