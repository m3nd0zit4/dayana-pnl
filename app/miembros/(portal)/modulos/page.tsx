import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import { getPublishedModules } from "@/lib/lms/course-content";

export const metadata: Metadata = {
  title: `Módulos — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const Page = async () => {
  const { membership, courseProduct } = await requirePortalContext();
  const isCurrent = membership.isCurrent;

  const modules = courseProduct
    ? await getPublishedModules(courseProduct.id)
    : [];

  return (
    <div className="space-y-10">
      <div>
        <div className="mb-3 font-[font2] uppercase text-xs tracking-[0.4em] text-linen/70">
          Material del curso
        </div>
        <h1 className="font-[font2] uppercase text-3xl leading-[0.95] lg:text-5xl">
          Módulos
        </h1>
      </div>

      {!isCurrent && (
        <div className="rounded-2xl border border-blush/25 bg-blush/[0.06] p-5 font-[font1] text-sm text-white/80">
          Renueva tu mensualidad para leer los módulos.{" "}
          <Link
            href="/miembros/cuenta"
            className="text-linen underline underline-offset-4"
          >
            Renovar
          </Link>
          .
        </div>
      )}

      {modules.length > 0 ? (
        <ul className="space-y-3">
          {modules.map((mod, i) => (
            <li key={mod.id}>
              {isCurrent ? (
                <Link
                  href={`/miembros/modulos/${mod.id}`}
                  className="flex items-center gap-5 rounded-2xl border border-linen/10 bg-linen/[0.03] px-6 py-5 transition-colors hover:border-linen/30"
                >
                  <span className="font-[font2] text-sm text-white/35">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[font1] text-base text-white/90">
                    {mod.title}
                  </span>
                  <span aria-hidden className="ml-auto text-white/30">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-5 rounded-2xl border border-linen/10 bg-linen/[0.02] px-6 py-5 opacity-60">
                  <span className="font-[font2] text-sm text-white/35">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-[font1] text-base text-white/70">
                    {mod.title}
                  </span>
                  <span className="ml-auto font-[font2] uppercase text-[9px] tracking-[0.2em] text-white/40">
                    Bloqueado
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-[font1] text-sm text-white/50">
          Los módulos se publicarán aquí muy pronto.
        </p>
      )}
    </div>
  );
};

export default Page;
