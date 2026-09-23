import { requireOwnerSettings } from "@/app/admin/(panel)/ajustes/owner-gate";
import WhatsAppAgentLauncher from "@/app/components/admin/whatsapp/WhatsAppAgentLauncher";

export const dynamic = "force-dynamic";

const Page = async () => {
  await requireOwnerSettings();
  return (
    <div className="flex min-h-0 flex-1 md:h-full">
      <WhatsAppAgentLauncher />
    </div>
  );
};

export default Page;
