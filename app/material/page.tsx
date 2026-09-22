import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import RevealScope from "@/app/components/common/RevealScope";
import { listActiveMagnets } from "@/lib/crm/magnets";
import { BRAND } from "@/lib/contact";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Materiales | ${BRAND.name}`,
  robots: { index: false, follow: false },
};

/**
 * Para quien llega a `/material` sin la palabra: el comentario decía «ÉXITO»
 * pero el enlace se copió a medias, o lo compartieron de boca en boca. En vez
 * de un 404, la lista de lo que hay abierto ahora mismo.
 */
const MaterialIndexPage = async () => {
  const magnets = await listActiveMagnets();
  if (magnets.length === 0) notFound();

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-hero-paper px-5 py-12 text-ink">
      <RevealScope className="w-full max-w-md" selector=".reveal" y={24} step={0}>
        <div className="reveal">
          <p className="font-[font2] text-[10px] uppercase tracking-[0.3em] text-terracotta">
            {BRAND.name}
          </p>

          <h1 className="mt-4 font-[font2] text-3xl uppercase leading-[0.95]">
            Elige tu material
          </h1>

          <p className="mt-3 font-[font1] text-base leading-snug text-black/60">
            Toca la palabra que escribiste en el comentario.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {magnets.map((m) => (
              <Link
                key={m.id}
                href={`/material/${m.keyword}`}
                className="rounded-2xl border border-black/10 bg-white px-5 py-4 transition-colors hover:border-black/30"
              >
                <span className="font-[font2] text-[10px] uppercase tracking-[0.24em] text-terracotta">
                  {m.label}
                </span>
                <span className="mt-1 block font-[font1] text-lg leading-snug text-[#141118]">
                  {m.title}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </RevealScope>
    </main>
  );
};

export default MaterialIndexPage;
