import Link from "next/link";
import type { ReactNode } from "react";

type MemberAuthShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * Marco de las páginas de acceso: marca, título, tarjeta de formulario.
 *
 * Va con tokens y no con valores fijos. Estaba clavado en claro —`bg-linen`,
 * tarjeta `bg-white`, texto `#141118`— mientras que los formularios de dentro
 * sí reaccionan al tema, y `/miembros` monta el ThemeProvider con
 * `enableSystem`: en un equipo con el sistema en oscuro salía texto claro sobre
 * una tarjeta blanca fija y el formulario no se leía. En claro los tokens valen
 * prácticamente lo mismo que los literales que sustituyen (`--background`
 * #f6f2eb ≈ linen, `--card` #fffcf8 ≈ blanco), así que el aspecto no cambia;
 * lo que cambia es que ahora el marco y su contenido siempre coinciden.
 */
const MemberAuthShell = ({ title, description, children }: MemberAuthShellProps) => (
  <main className="relative flex min-h-screen flex-col bg-background text-foreground">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        background:
          "radial-gradient(55% 40% at 50% 0%, rgba(237,195,177,0.35), transparent 65%)",
      }}
    />

    <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <Link
          href="/"
          className="mx-auto block w-fit text-center font-[font2] uppercase leading-none transition-opacity hover:opacity-80"
        >
          <span className="block text-sm tracking-[0.16em] text-foreground">
            Dayana Beltrán
          </span>
          <span className="mt-1.5 block text-[9px] tracking-[0.5em] text-foreground/40">
            PNL
          </span>
        </Link>

        <h1 className="mt-10 text-center font-[font2] uppercase text-lg tracking-[0.08em]">
          {title}
        </h1>
        {description ? (
          <p className="mx-auto mt-2 max-w-[300px] text-center font-[font1] text-[13px] leading-relaxed text-foreground/55">
            {description}
          </p>
        ) : null}

        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-[0_10px_30px_rgba(20,17,24,0.06)] sm:p-7">
          {children}
        </div>

        <Link
          href="/"
          className="mx-auto mt-8 block w-fit font-[font1] text-[12px] text-foreground/45 transition-colors hover:text-foreground/75"
        >
          ← Volver al inicio
        </Link>
      </div>
    </div>
  </main>
);

export default MemberAuthShell;
