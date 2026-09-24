import WhatsAppCommunityDetailClient from "@/app/components/admin/whatsapp/WhatsAppCommunityDetailClient";

export const dynamic = "force-dynamic";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <WhatsAppCommunityDetailClient id={id} />;
};

export default Page;
