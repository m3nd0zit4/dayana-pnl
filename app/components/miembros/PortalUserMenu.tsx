"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LayoutDashboard, LogOut, Settings } from "lucide-react";
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

type PortalUserMenuProps = {
  displayName: string;
  avatarUrl: string | null;
  /** True when this "member" session is really the OWNER's staff session,
   *  bridged in via lib/auth/portal-viewer.ts — show her a way back to the CRM. */
  isOwner?: boolean;
};

const PortalUserMenu = ({ displayName, avatarUrl, isOwner = false }: PortalUserMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Avatar size="sm">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
        <AvatarFallback>{initials(displayName)}</AvatarFallback>
      </Avatar>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuGroup>
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </p>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      {!isOwner && (
        <DropdownMenuItem render={<Link href="/miembros/cuenta/general" />}>
          <Settings />
          Mi cuenta
        </DropdownMenuItem>
      )}
      {isOwner && (
        <DropdownMenuItem render={<Link href="/admin" />}>
          <LayoutDashboard />
          CRM
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={() => signOut({ callbackUrl: "/acceso" })}
      >
        <LogOut />
        Salir
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export default PortalUserMenu;
