import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BRAND } from "@/lib/contact";
import { requirePortalContext } from "@/lib/lms/portal";
import { getPublishedModule } from "@/lib/lms/course-content";

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

  const courseModule = await getPublishedModule(courseProduct.id, id);
  if (!courseModule) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-2xl">
      <Link
        href="/miembros/modulos"
        className="font-[font1] text-[13px] text-white/50 transition-colors hover:text-white"
      >
        <span aria-hidden>←</span> Todos los módulos
      </Link>

      <h1 className="mt-8 font-[font2] uppercase text-3xl leading-[0.98] lg:text-4xl">
        {courseModule.title}
      </h1>

      <div className="prose-portal mt-10 font-[font1] text-[15px] leading-relaxed text-white/80">
        <Markdown remarkPlugins={[remarkGfm]}>
          {courseModule.bodyMd ?? ""}
        </Markdown>
      </div>
    </article>
  );
};

export default Page;
