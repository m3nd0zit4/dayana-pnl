import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import { getPublishedModules } from "@/lib/lms/course-content";
import { getCompletedModuleIds } from "@/lib/lms/module-progress";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import ModulesList from "@/app/components/miembros/ModulesList";

export const metadata: Metadata = {
  title: `Módulos — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const Page = async () => {
  const { contact, membership, courseProduct } = await requirePortalContext();
  const isCurrent = membership.isCurrent;

  const [modules, completedIds] = await Promise.all([
    courseProduct ? getPublishedModules(courseProduct.id) : Promise.resolve([]),
    getCompletedModuleIds(contact.id),
  ]);
  const completedCount = modules.filter((m) => completedIds.has(m.id)).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
          Módulos
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          El material del curso, en orden. Léelo a tu ritmo.
          {modules.length > 0 && isCurrent
            ? ` ${completedCount}/${modules.length} completados.`
            : ""}
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
        <ModulesList modules={modules} isCurrent={isCurrent} completedIds={completedIds} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Los módulos se publicarán aquí muy pronto.
        </p>
      )}
    </div>
  );
};

export default Page;
