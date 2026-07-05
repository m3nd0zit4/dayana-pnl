"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/curso", label: "Miembros", exact: true },
  { href: "/admin/curso/clases", label: "Clases" },
  { href: "/admin/curso/modulos", label: "Módulos" },
];

const CursoTabs = () => {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones del curso" className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              active
                ? "crm-btn-primary crm-btn-compact"
                : "crm-btn-secondary crm-btn-compact"
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};

export default CursoTabs;
