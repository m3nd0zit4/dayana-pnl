"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/app/components/ui/button";

export type SettingsNavItem = {
  href: string;
  label: string;
};

const SettingsNav = ({ items }: { items: SettingsNavItem[] }) => {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Button
            key={item.href}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            nativeButton={false}
            className="shrink-0 justify-start whitespace-nowrap sm:w-full"
            render={<Link href={item.href} replace />}
          >
            {item.label}
          </Button>
        );
      })}
    </nav>
  );
};

export default SettingsNav;
