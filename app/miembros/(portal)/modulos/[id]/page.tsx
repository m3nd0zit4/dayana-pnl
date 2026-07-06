import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import { getPublishedModule, getPublishedModules } from "@/lib/lms/course-content";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";

export const metadata: Metadata = {
  title: `Módulo — ${BRAND.name}`,
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ id: string }>;
};

const Page = async ({ params }: PageProps) => {
  const { id } = await params;
  const { membership, courseProduct } = await requirePortalContext();

  if (!membership.isCurrent) {
    redirect("/miembros/cuenta");
  }
  if (!courseProduct) {
    notFound();
  }

  const [courseModule, allModules] = await Promise.all([
    getPublishedModule(courseProduct.id, id),
    getPublishedModules(courseProduct.id),
  ]);
  if (!courseModule) {
    notFound();
  }

  const index = allModules.findIndex((m) => m.id === courseModule.id);
  const prev = index > 0 ? allModules[index - 1] : null;
  const next =
    index >= 0 && index < allModules.length - 1 ? allModules[index + 1] : null;

  return (
    <article className="mx-auto max-w-2xl">
      <Link
        href="/miembros/modulos"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Todos los módulos
      </Link>

      <Card className="mt-4">
        <CardContent className="px-6 py-8 sm:px-10 sm:py-10">
          {index >= 0 && (
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Módulo {index + 1} de {allModules.length}
            </div>
          )}
          <h1 className="mt-2 text-xl leading-snug font-semibold lg:text-2xl">
            {courseModule.title}
          </h1>

          <div className="prose-portal mt-8">
            <Markdown remarkPlugins={[remarkGfm]}>
              {courseModule.bodyMd ?? ""}
            </Markdown>
          </div>
        </CardContent>
      </Card>

      {(prev || next) && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {prev ? (
            <Button variant="outline" nativeButton={false} render={<Link href={`/miembros/modulos/${prev.id}`} />}>
              ← Anterior
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button nativeButton={false} render={<Link href={`/miembros/modulos/${next.id}`} />}>
              Siguiente →
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
};

export default Page;
