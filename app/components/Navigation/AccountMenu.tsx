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
 * El control de identidad del sitio: arriba a la derecha, en todas las
 * páginas, y **el único**. Por eso `/cursos` ya no repite el estado de la
 * cuenta en una tira propia y `/cuenta` no arrastra la barra lateral del
 * portal: con dos sitios donde mirar quién eres, tarde o temprano dicen cosas
 * distintas.
 *
 * Sin sesión son dos botones explícitos —«Ingresar» y «Crear cuenta»—: un
 * avatar vacío no invita a nada.
 *
 * **El staff no tiene cuenta de miembro.** Está prohibido a propósito
 * (`lib/crm/member-accounts.ts`), así que su perfil vive en
 * `/admin/ajustes/perfil`. Mientras este menú apuntó a la cuenta de miembro
 * para todo el mundo, Dayana caía en un bucle: la ruta exigía un
 * `MemberAccount`, rebotaba a `/acceso`, y `/acceso` la mandaba a elegir entre
 * CRM y portal perdiendo por el camino a dónde quería ir.
 *
 * La sesión se lee en cliente (`useSession`) para no volver dinámicas las
 * páginas públicas; ver Providers.
 */
const AccountMenu = ({ navColor }: { navColor: string }) => {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  const kind =
    status === "authenticated" ? (session?.user?.kind ?? null) : null;
  // OWNER staff also has course-portal access (lib/auth/portal-viewer.ts) —
  // everyone else on staff stays CRM-only.
  const isOwnerStaff = kind === "staff" && session?.user?.role === "OWNER";
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
      {/*
        Con foto, la foto llena el círculo y el borde es sólo un aro fino que
        la separa de la sección de debajo. Sin foto, las iniciales van sobre
        terracota sólida en vez de sobre un aro hueco: un círculo vacío con dos
        letras finas dentro no se lee como «tú», se lee como un icono más de la
        barra. Es también lo único de la cabecera que cambia de persona a
        persona, así que merece el único color de la fila.
      */}
      <DropdownMenuTrigger
        aria-label={displayName ? `Cuenta de ${displayName}` : "Mi cuenta"}
        className="ml-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-full outline-none ring-1 transition-[box-shadow,transform] hover:scale-105 focus-visible:ring-2 lg:ml-4 lg:size-10"
        style={{
          // El aro toma el color de la sección para no desaparecer sobre un
          // fondo oscuro ni recortarse sobre uno claro.
          ["--tw-ring-color" as string]: navColor,
        }}
      >
        <Avatar className="size-full after:hidden">
          {avatarUrl && (
            <AvatarImage src={avatarUrl} alt={displayName ?? ""} />
          )}
          <AvatarFallback className="bg-terracotta text-[11px] font-semibold tracking-[0.06em] text-white lg:text-[13px]">
            {displayName ? initials(displayName) : null}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {displayName ? (
          <>
            <DropdownMenuGroup>
              {/* Nombre completo y correo, no «Hola, Dayana». El saludo ocupa
                  la misma línea y no dice con CUÁL de sus cuentas está dentro,
                  que es justo lo que se viene a comprobar al abrir esto. */}
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-semibold text-foreground">
                  {displayName}
                </p>
                {session?.user?.email ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {session.user.email}
                  </p>
                ) : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuGroup>
          {kind === "staff" ? (
            <>
              <DropdownMenuItem render={<Link href="/admin" />}>
                <LayoutDashboard />
                CRM
              </DropdownMenuItem>
              {/* Sólo OWNER — lib/auth/portal-viewer.ts es lo que puentea su
                  sesión de staff hacia el curso. El resto del equipo se queda
                  en el CRM y la plataforma los rechaza igual. */}
              {isOwnerStaff ? (
                <DropdownMenuItem render={<Link href="/cursos" />}>
                  <BookOpen />
                  Mis cursos
                </DropdownMenuItem>
              ) : null}
              {/* Su perfil está aquí y no en /cuenta: el staff no tiene
                  `MemberAccount`, y esa ruta la devolvería a /acceso. */}
              <DropdownMenuItem render={<Link href="/admin/ajustes/perfil" />}>
                <Settings />
                Mi perfil
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem render={<Link href="/cursos" />}>
                <BookOpen />
                Mis cursos
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/cuenta" />}>
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
