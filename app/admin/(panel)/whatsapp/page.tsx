import WhatsAppChatsClient from "@/app/components/admin/whatsapp/WhatsAppChatsClient";

export const dynamic = "force-dynamic";

const WhatsAppPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) => {
  const { conversation } = await searchParams;
  return (
    <div className="flex min-h-0 flex-1 md:h-full">
      <WhatsAppChatsClient initialConversationId={conversation ?? null} />
    </div>
  );
};

export default WhatsAppPage;
