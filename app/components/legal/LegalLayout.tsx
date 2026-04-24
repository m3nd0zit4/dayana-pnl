import Link from "next/link";
import { ReactNode } from "react";
import Footer from "../home/Footer";

type LegalLayoutProps = {
  eyebrow: string;
  title: string;
  updatedAt: string;
  children: ReactNode;
};

const LegalLayout = ({
  eyebrow,
  title,
  updatedAt,
  children,
}: LegalLayoutProps) => {
  return (
    <>
      <main className="relative bg-black text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-80"
          style={{
            background: [
              "radial-gradient(60% 40% at 15% 10%, rgba(236,227,212,0.12), transparent 60%)",
              "radial-gradient(50% 45% at 85% 90%, rgba(237,195,177,0.14), transparent 65%)",
            ].join(","),
          }}
        />

        <article className="relative px-4 lg:px-8 pt-36 lg:pt-44 pb-24 max-w-3xl mx-auto">
          <div className="font-[font2] uppercase text-xs tracking-[0.4em] text-linen/80 mb-5">
            {eyebrow}
          </div>
          <h1 className="font-[font2] uppercase text-4xl lg:text-6xl leading-[0.95] mb-8">
            {title}
          </h1>
          <p className="font-[font1] text-sm text-white/55 mb-12">
            Última actualización: {updatedAt}
          </p>

          <div className="legal-prose font-[font1] text-white/80 text-base lg:text-lg leading-relaxed space-y-6">
            {children}
          </div>

          <div className="mt-16 pt-8 border-t border-linen/15 flex flex-wrap gap-x-6 gap-y-3 text-xs font-[font2] uppercase tracking-[0.3em] text-white/60">
            <Link href="/" className="hover:text-linen transition-colors">
              ← Volver al inicio
            </Link>
            <Link
              href="/aviso-privacidad"
              className="hover:text-linen transition-colors"
            >
              Aviso de privacidad
            </Link>
            <Link
              href="/terminos"
              className="hover:text-linen transition-colors"
            >
              Términos
            </Link>
            <Link href="/cookies" className="hover:text-linen transition-colors">
              Cookies
            </Link>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
};

export default LegalLayout;
