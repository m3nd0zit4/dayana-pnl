import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import { getClassesForCourse } from "@/lib/lms/course-content";
import ClassesList from "@/app/components/miembros/ClassesList";
import { Alert, AlertDescription } from "@/app/components/ui/alert";

export const metadata: Metadata = {
  title: `Clases — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

const Page = async () => {
  const { membership, courseProduct } = await requirePortalContext();
  const isCurrent = membership.isCurrent;

  const { upcoming, past, now } = courseProduct
    ? await getClassesForCourse(courseProduct.id)
    : { upcoming: [], past: [], now: new Date() };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
          Tus clases
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Las clases son en vivo por Google Meet. La grabación queda disponible
          aquí durante un mes.
        </p>
      </div>

      {!isCurrent && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-800">
            Tu mensualidad no está al día — los enlaces y grabaciones están
            bloqueados.{" "}
            <Link href="/miembros/cuenta" className="font-semibold underline underline-offset-4">
              Renueva aquí
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <ClassesList upcoming={upcoming} past={past} now={now} isCurrent={isCurrent} />
    </div>
  );
};

export default Page;
