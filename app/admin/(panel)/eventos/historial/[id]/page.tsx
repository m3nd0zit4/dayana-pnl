import { permanentRedirect } from "next/navigation";

/** Cada evento tiene ahora su página (con su historia en una pestaña). */
const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  permanentRedirect(`/admin/eventos/${encodeURIComponent(id)}?tab=historia`);
};

export default Page;
