import Link from "next/link";
import type { ReactNode } from "react";

type MemberAuthShellProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/** Marco minimalista para las páginas de acceso: marca, título, tarjeta de formulario. */
const MemberAuthShell = ({ title, description, children }: MemberAuthShellProps) => (
  <main className="relative flex min-h-screen flex-col bg-black text-white">
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-70"
      style={{
        background:
          "radial-gradient(55% 40% at 50% 0%, rgba(192,101,74,0.14), transparent 65%)",
      }}
    />

    <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[380px]">
        <Link
          href="/"
          className="mx-auto block w-fit text-center font-[font2] uppercase leading-none transition-opacity hover:opacity-80"
        >
          <span className="block text-sm tracking-[0.16em] text-linen">
            Dayana Beltrán
          </span>
          <span className="mt-1.5 block text-[9px] tracking-[0.5em] text-white/40">
            PNL
          </span>
        </Link>

        <h1 className="mt-10 text-center font-[font2] uppercase text-lg tracking-[0.08em]">
          {title}
        </h1>
        {description ? (
          <p className="mx-auto mt-2 max-w-[300px] text-center font-[font1] text-[13px] leading-relaxed text-white/55">
            {description}
          </p>
        ) : null}

        <div className="mt-8 rounded-2xl border border-linen/15 bg-linen/[0.04] p-6 sm:p-7">
          {children}
        </div>

        <Link
          href="/"
          className="mx-auto mt-8 block w-fit font-[font1] text-[12px] text-white/35 transition-colors hover:text-white/70"
        >
          ← Volver al inicio
        </Link>
      </div>
    </div>
  </main>
);

export default MemberAuthShell;
