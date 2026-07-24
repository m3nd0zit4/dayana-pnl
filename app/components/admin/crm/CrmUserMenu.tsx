"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Settings } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

type CrmUserMenuProps = {
  displayName: string;
  role: string;
  avatarUrl: string | null;
};

const CrmUserMenu = ({ displayName, role, avatarUrl }: CrmUserMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Avatar>
        {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
        <AvatarFallback>{initials(displayName)}</AvatarFallback>
      </Avatar>
      <span className="hidden max-w-32 truncate text-sm font-medium text-[var(--crm-topbar-foreground)] md:block">
        {displayName}
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{role}</p>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem render={<Link href="/admin/mi-cuenta/general" />}>
        <Settings />
        Mi cuenta
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={() => signOut({ callbackUrl: "/acceso" })}
      >
        <LogOut />
        Cerrar sesión
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export default CrmUserMenu;
