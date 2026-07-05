import Link from "next/link";
import { BRAND } from "@/lib/contact";

const AdminNotFound = () => (
  <div
    className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
    style={{
      background:
        "radial-gradient(60% 50% at 50% 0%, rgba(237,195,177,0.35), transparent), var(--crm-background)",
    }}
  >
    <div className="crm-surface-card w-full max-w-md space-y-6 p-8 text-center">
      <p
        className="crm-font-display text-[10px] tracking-[0.45em] text-[var(--crm-muted)]"
        aria-hidden
      >
        404
      </p>
      <div className="font-[font2] uppercase leading-none text-[var(--crm-foreground)]">
        <span className="block text-base tracking-[0.14em]">{BRAND.name}</span>
        <span className="mt-1.5 block text-[10px] tracking-[0.5em] opacity-70">
          PNL
        </span>
      </div>
      <h1 className="text-lg font-semibold text-[var(--crm-foreground)]">
        Ruta no encontrada
      </h1>
      <p className="text-sm leading-relaxed text-[var(--crm-muted)]">
        Esta sección del panel no existe o fue movida. Vuelve al inicio del CRM
        o inicia sesión de nuevo si tu sesión expiró.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href="/admin" className="crm-btn-primary px-6 py-2.5 text-center">
          Ir al panel
        </Link>
        <Link
          href="/acceso"
          className="crm-btn-secondary px-6 py-2.5 text-center"
        >
          Iniciar sesión
        </Link>
      </div>
      <Link
        href="/"
        className="inline-block text-xs text-[var(--crm-muted)] transition-colors hover:text-[var(--crm-accent)]"
      >
        ← Volver a {BRAND.shortName.toLowerCase()}
      </Link>
    </div>
  </div>
);

export default AdminNotFound;
