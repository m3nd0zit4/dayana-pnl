"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { BookOpen, LayoutDashboard, LogOut, User } from "lucide-react";

/**
 * Account area at the far right of the public header.
 * Logged out: explicit "Ingresar" / "Crear cuenta" buttons.
 * Logged in: an account icon opening a dropdown that routes by session
 * kind — members to the course portal and their account, staff to the CRM
 * (plus the portal, since staff often need to see the member side).
 * Session is read client-side (useSession) so public pages keep static
 * rendering; see Providers for the rationale.
 */
const AccountMenu = ({ navColor }: { navColor: string }) => {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const kind =
    status === "authenticated" ? (session?.user?.kind ?? null) : null;
  const firstName = session?.user?.name?.split(" ")[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close the menu on navigation — state adjustment during render (the
  // React-recommended alternative to a setState-in-effect).
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

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

  const menuItemClass =
    "flex items-center gap-2.5 px-4 py-3 font-[font2] text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-white/10";

  return (
    <div ref={rootRef} className="relative ml-3 lg:ml-4">
      <button
        type="button"
        aria-label="Mi cuenta"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-center rounded-full border lg:h-10 h-8 lg:w-10 w-8 transition-colors ${hoverBg} cursor-pointer`}
        style={{ borderColor: navColor, color: navColor }}
      >
        <User className="lg:h-[18px] lg:w-[18px] h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[210px] overflow-hidden rounded-2xl border border-white/12 bg-black text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
        >
          {firstName ? (
            <div className="border-b border-white/10 px-4 py-3 font-[font1] text-sm text-white/70">
              Hola, <span className="text-white">{firstName}</span>
            </div>
          ) : null}

          {kind === "staff" ? (
            /* Staff sessions can't enter /miembros (the portal validates
               kind === "member"), so no portal cross-link — logging in
               there would replace their CRM session. */
            <a href="/admin" role="menuitem" className={menuItemClass}>
              <LayoutDashboard className="h-4 w-4 text-white/60" aria-hidden />
              CRM
            </a>
          ) : (
            <>
              <a href="/miembros" role="menuitem" className={menuItemClass}>
                <BookOpen className="h-4 w-4 text-white/60" aria-hidden />
                Portal del curso
              </a>
              <a
                href="/miembros/cuenta"
                role="menuitem"
                className={menuItemClass}
              >
                <User className="h-4 w-4 text-white/60" aria-hidden />
                Mi cuenta
              </a>
            </>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: pathname ?? "/" })}
            className={`${menuItemClass} w-full text-white/85 cursor-pointer`}
          >
            <LogOut className="h-4 w-4 text-white/60" aria-hidden />
            Salir
          </button>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
