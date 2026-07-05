import Link from "next/link";
import type { ReactNode } from "react";

type MemberAuthShellProps = {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
};

const MemberAuthShell = ({
  eyebrow,
  title,
  description,
  children,
}: MemberAuthShellProps) => (
  <main className="relative min-h-screen bg-black text-white overflow-hidden">
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none opacity-80"
      style={{
        background: [
          "radial-gradient(60% 40% at 15% 10%, rgba(236,227,212,0.10), transparent 60%)",
          "radial-gradient(50% 45% at 85% 90%, rgba(237,195,177,0.12), transparent 65%)",
        ].join(","),
      }}
    />

    <section className="relative px-4 pt-28 lg:pt-36 pb-24 max-w-md mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-2 font-[font1] text-[13px] text-white/50 transition-colors hover:text-white"
      >
        <span aria-hidden>←</span>
        Volver a dayanabeltran.com
      </Link>

      <div className="mt-10 mb-8">
        <div className="font-[font2] uppercase text-xs tracking-[0.4em] text-linen/80 mb-4">
          {eyebrow}
        </div>
        <h1 className="font-[font2] uppercase text-3xl lg:text-4xl leading-[0.95]">
          {title}
        </h1>
        {description ? (
          <p className="mt-4 font-[font1] text-white/70 text-sm leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-linen/15 bg-linen/[0.04] p-6 sm:p-8">
        {children}
      </div>
    </section>
  </main>
);

export default MemberAuthShell;
