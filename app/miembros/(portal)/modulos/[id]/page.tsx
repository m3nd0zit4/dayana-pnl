import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/** Superseded by the course player — deep-links straight to this module's
 *  reading entry there, for any bookmarks/emails already pointing here. */
const Page = async ({ params }: PageProps) => {
  const { id } = await params;
  const courseModule = await prisma.courseModule.findUnique({
    where: { id },
    select: { productId: true },
  });
  if (!courseModule) notFound();

  redirect(`/miembros/curso/${courseModule.productId}?c=reading:${id}`);
};

export default Page;
