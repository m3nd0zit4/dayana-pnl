"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { crmMenuSections } from "@/app/config/crm-menu-items";

const CrmMenu = () => {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return false;
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="mt-4 flex flex-col gap-2.5 text-sm" aria-label="Menú CRM">
      {crmMenuSections.map((section) => (
        <div key={section.title}>
          <p className="mb-1 hidden px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--crm-muted)] lg:block">
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const external = item.external === true;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={external ? undefined : false}
                    {...(external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={`flex h-9 w-full items-center justify-center gap-2.5 rounded-xl px-2.5 transition-colors lg:justify-start ${
                      active
                        ? "crm-active-menu"
                        : "text-[var(--crm-muted)] hover:bg-[var(--crm-linen)]/50 hover:text-[var(--crm-foreground)]"
                    }`}
                  >
                    <Icon
                      className={`size-[18px] shrink-0 ${active ? "text-[var(--crm-accent)]" : ""}`}
                      strokeWidth={active ? 2.25 : 1.75}
                      aria-hidden
                    />
                    <span className="hidden text-[13px] leading-none lg:inline">
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
};

export default CrmMenu;
