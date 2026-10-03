import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * El WhatsApp de un taller vive ahora en su pestaña. Esta ruta queda para los
 * enlaces y avisos que ya la usaban.
 */
const Page = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  redirect(`/admin/workshops/${encodeURIComponent(slug)}?tab=whatsapp`);
};

export default Page;
