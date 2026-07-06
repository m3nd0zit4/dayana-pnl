import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import { getPublishedModules } from "@/lib/lms/course-content";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { cn } from "@/lib/utils";

const moduleRowClass =
  "flex items-center gap-4 rounded-xl bg-card px-5 py-4 text-sm ring-1 ring-foreground/10 transition-shadow";

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
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
          Módulos
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          El material del curso, en orden. Léelo a tu ritmo.
        </p>
      </div>

      {!isCurrent && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-800">
            Renueva tu mensualidad para leer los módulos.{" "}
            <Link href="/miembros/cuenta" className="font-semibold underline underline-offset-4">
              Renovar
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {modules.length > 0 ? (
        <ul className="space-y-3">
          {modules.map((mod, i) => (
            <li key={mod.id}>
              {isCurrent ? (
                <Link
                  href={`/miembros/modulos/${mod.id}`}
                  className={cn(moduleRowClass, "hover:shadow-md")}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/40 text-sm font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium">{mod.title}</span>
                  <ArrowRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
                </Link>
              ) : (
                <div className={cn(moduleRowClass, "opacity-70")}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-500">
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">
                    {mod.title}
                  </span>
                  <Lock className="ml-auto size-4 text-muted-foreground" aria-hidden />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Los módulos se publicarán aquí muy pronto.
        </p>
      )}
    </div>
  );
};

export default Page;
