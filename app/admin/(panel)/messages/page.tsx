import MessagesPageClient from "@/app/components/admin/crm/MessagesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

const MessagesPage = () => <MessagesPageClient preview={isCrmUiPreview()} />;

export default MessagesPage;
