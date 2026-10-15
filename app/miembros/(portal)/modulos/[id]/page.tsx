import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { moduleStartId } from "@/lib/lms/course-sequence";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/** Superseded by the course player — deep-links straight to this module's
 *  first entry there (its «Introducción», or its first lesson when the module
 *  has no text), for any bookmarks/emails already pointing here. */
const Page = async ({ params }: PageProps) => {
  const { id } = await params;
  const courseModule = await prisma.courseModule.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      bodyMd: true,
      // Mismo orden que `getCourseOutline`: la primera es la que el temario
      // pinta primero.
      classes: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!courseModule) notFound();

  // Antes iba siempre a `reading:<id>`, que en un módulo sin texto abría una
  // Introducción vacía que ni siquiera aparece en el temario.
  const start = moduleStartId(courseModule);
  redirect(
    start
      ? `/miembros/curso/${courseModule.productId}?c=${start}`
      : `/miembros/curso/${courseModule.productId}`
  );
};

export default Page;
