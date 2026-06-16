"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { crmMenuSections } from "@/app/config/crm-menu-items";

type Props = {
  showLabels?: boolean;
  onNavigate?: () => void;
};

const CrmMenu = ({ showLabels = false, onNavigate }: Props) => {
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
          <p
            className={`mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--crm-muted)] ${showLabels ? "block" : "hidden lg:block"}`}
          >
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
                    onClick={onNavigate}
                    {...(external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={`flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 transition-colors ${
                      showLabels ? "justify-start" : "justify-center lg:justify-start"
                    } ${
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
                    <span
                      className={`text-[13px] leading-none ${showLabels ? "inline" : "hidden lg:inline"}`}
                    >
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
