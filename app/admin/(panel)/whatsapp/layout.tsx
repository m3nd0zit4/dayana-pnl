import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isCrmUiPreview } from "@/lib/auth/preview";
import { isWhatsAppWorkspaceAvailable } from "@/lib/crm/whatsapp-agent/workspace";

export const dynamic = "force-dynamic";

// Instalar esta sección en el teléfono (Añadir a pantalla de inicio) es lo que
// permite los avisos push en iPhone.
export const metadata: Metadata = {
  title: "WhatsApp · CRM",
  manifest: "/admin.webmanifest",
};

const WhatsAppLayout = async ({ children }: { children: React.ReactNode }) => {
  if (!isCrmUiPreview() && !(await isWhatsAppWorkspaceAvailable())) notFound();
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
};

export default WhatsAppLayout;
