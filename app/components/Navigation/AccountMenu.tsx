"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { LogOut, User } from "lucide-react";

/**
 * Account control at the far right of the public header.
 * Logged out (or staff session): a round icon linking to /acceso.
 * Logged in as member: the icon opens a small dropdown — greeting,
 * Mi cuenta, Salir. Session is read client-side (useSession) so public
 * pages keep static rendering; see Providers for the rationale.
 */
const AccountMenu = ({ navColor }: { navColor: string }) => {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isMember =
    status === "authenticated" && session?.user?.kind === "member";
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

  const triggerClass =
    "inline-flex items-center justify-center rounded-full border lg:h-10 h-8 lg:w-10 w-8 ml-3 lg:ml-4 transition-colors hover:bg-black/5 cursor-pointer";

  if (!isMember) {
    return (
      <a
        href="/acceso"
        aria-label="Ingresar a mi cuenta"
        className={triggerClass}
        style={{ borderColor: navColor, color: navColor }}
      >
        <User className="lg:h-[18px] lg:w-[18px] h-4 w-4" aria-hidden />
      </a>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Mi cuenta"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={triggerClass}
        style={{ borderColor: navColor, color: navColor }}
      >
        <User className="lg:h-[18px] lg:w-[18px] h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 min-w-[190px] overflow-hidden rounded-2xl border border-white/12 bg-black text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
        >
          {firstName ? (
            <div className="border-b border-white/10 px-4 py-3 font-[font1] text-sm text-white/70">
              Hola, <span className="text-white">{firstName}</span>
            </div>
          ) : null}
          <a
            href="/miembros/cuenta"
            role="menuitem"
            className="flex items-center gap-2.5 px-4 py-3 font-[font2] text-[11px] uppercase tracking-[0.18em] transition-colors hover:bg-white/10"
          >
            <User className="h-4 w-4 text-white/60" aria-hidden />
            Mi cuenta
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut({ callbackUrl: pathname ?? "/" })}
            className="flex w-full items-center gap-2.5 px-4 py-3 font-[font2] text-[11px] uppercase tracking-[0.18em] text-white/85 transition-colors hover:bg-white/10 cursor-pointer"
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
