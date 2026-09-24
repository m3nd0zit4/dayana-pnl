import WhatsAppTemplatesClient from "@/app/components/admin/whatsapp/WhatsAppTemplatesClient";
import { getStaffSession } from "@/lib/auth/staff-session";

export const dynamic = "force-dynamic";

const Page = async () => {
  const staff = await getStaffSession();
  return <WhatsAppTemplatesClient canEdit={staff?.role === "OWNER"} />;
};

export default Page;
