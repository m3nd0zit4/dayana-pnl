"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { BookOpen, LayoutDashboard, LogOut, Settings } from "lucide-react";
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

/**
 * Account area at the far right of the public header.
 * Logged out: explicit "Ingresar" / "Crear cuenta" buttons.
 * Logged in: the same avatar + dropdown pattern as CrmUserMenu /
 * PortalUserMenu, so the profile control reads as one identity across the
 * public site, the member portal, and the CRM.
 * Session is read client-side (useSession) so public pages keep static
 * rendering; see Providers for the rationale.
 */
const AccountMenu = ({ navColor }: { navColor: string }) => {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const kind =
    status === "authenticated" ? (session?.user?.kind ?? null) : null;
  const displayName = session?.user?.name ?? null;
  const firstName = displayName?.split(" ")[0] ?? null;
  const avatarUrl = session?.user?.avatarUrl ?? null;

  const pillBase =
    "inline-flex items-center justify-center rounded-full border uppercase tracking-[0.16em] lg:text-[11px] text-[10px] lg:px-4 px-3 lg:py-2.5 py-2 transition-colors";
  // navColor "white" = sección oscura debajo: el hover negro sería invisible.
  const hoverBg =
    navColor === "white" ? "hover:bg-white/10" : "hover:bg-black/5";

  if (!kind) {
    return (
      <div
        className="flex items-center gap-2 ml-3 lg:ml-4"
        style={{ fontFamily: "var(--font-grotesk)" }}
      >
        <a
          href="/acceso"
          className={`${pillBase} ${hoverBg}`}
          style={{ borderColor: navColor, color: navColor }}
        >
          Ingresar
        </a>
        <a
          href="/miembros/crear-cuenta"
          className={`${pillBase} hidden sm:inline-flex border-terracotta bg-terracotta text-white hover:opacity-90`}
        >
          Crear cuenta
        </a>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Mi cuenta"
        className={`ml-3 inline-flex items-center justify-center rounded-full border outline-none lg:ml-4 lg:h-10 h-8 lg:w-10 w-8 transition-colors ${hoverBg} cursor-pointer`}
        style={{ borderColor: navColor, color: navColor }}
      >
        <Avatar className="size-8 after:hidden lg:size-10">
          {avatarUrl && (
            <AvatarImage src={avatarUrl} alt={displayName ?? ""} />
          )}
          <AvatarFallback className="bg-transparent text-[inherit]">
            {displayName ? initials(displayName) : null}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {firstName ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm text-muted-foreground">
                  Hola,{" "}
                  <span className="font-semibold text-foreground">
                    {firstName}
                  </span>
                </p>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuGroup>
          {kind === "staff" ? (
            /* Staff sessions can't enter /miembros (the portal validates
               kind === "member"), so no portal cross-link — logging in
               there would replace their CRM session. */
            <DropdownMenuItem render={<Link href="/admin" />}>
              <LayoutDashboard />
              CRM
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem render={<Link href="/miembros" />}>
                <BookOpen />
                Portal del curso
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/miembros/cuenta" />}>
                <Settings />
                Mi cuenta
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => signOut({ callbackUrl: pathname ?? "/" })}
        >
          <LogOut />
          Salir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AccountMenu;
