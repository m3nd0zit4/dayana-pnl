import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import WhatsAppAssistantClient from "@/app/components/admin/whatsapp/WhatsAppAssistantClient";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();
  return (
    <div className="flex min-h-0 flex-1 md:h-full">
      <WhatsAppAssistantClient />
    </div>
  );
};

export default Page;
