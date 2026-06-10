import MessagesPageClient from "@/app/components/admin/crm/MessagesPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { isQuickMessageTemplate } from "@/lib/crm/quick-message-templates";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const MessagesPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <MessagesPageClient preview initialTemplates={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const rows = await prisma.messageTemplate.findMany({
    orderBy: [{ key: "asc" }, { locale: "asc" }],
  });

  const initialTemplates = rows
    .filter((t) => isQuickMessageTemplate(t.key))
    .map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title?.trim() || t.key.replace(/-/g, " "),
      body: t.body,
    }));

  return (
    <MessagesPageClient preview={false} initialTemplates={initialTemplates} />
  );
};

export default MessagesPage;
