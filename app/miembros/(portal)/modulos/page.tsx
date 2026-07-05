import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
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
    <div className="space-y-6">
      <div>
        <h1 className="portal-display text-2xl text-[var(--portal-foreground)] lg:text-3xl">
          Módulos
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--portal-muted)]">
          El material del curso, en orden. Léelo a tu ritmo.
        </p>
      </div>

      {!isCurrent && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Renueva tu mensualidad para leer los módulos.{" "}
          <Link
            href="/miembros/cuenta"
            className="font-semibold underline underline-offset-4"
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
                  className="portal-card flex items-center gap-4 px-5 py-4 transition-shadow hover:shadow-md"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgba(212,184,150,0.3)] text-sm font-semibold text-[var(--portal-accent)]">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{mod.title}</span>
                  <ArrowRight
                    className="ml-auto size-4 text-[var(--portal-muted)]"
                    aria-hidden
                  />
                </Link>
              ) : (
                <div className="portal-card flex items-center gap-4 px-5 py-4 opacity-70">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-500">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-[var(--portal-muted)]">
                    {mod.title}
                  </span>
                  <Lock
                    className="ml-auto size-4 text-[var(--portal-muted)]"
                    aria-hidden
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--portal-muted)]">
          Los módulos se publicarán aquí muy pronto.
        </p>
      )}
    </div>
  );
};

export default Page;
