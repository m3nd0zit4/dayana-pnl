import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildWhatsAppUrl } from "@/lib/contact";
import { currentSlugForPrevious } from "@/lib/crm/workshop-editions";
import { loadRegistrationEdition } from "@/lib/crm/workshop-registration";
import { workshopWhatsAppMessage } from "@/lib/crm/workshop-registration-rules";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { robots: { index: false } };

/**
 * Ya no hay registro del taller (dueña, 13-nov: «quita la lógica de
 * registro… que llegue la persona directamente a WhatsApp preguntando por
 * ello»). Los enlaces viejos a `/taller-virtual/<slug>/registro` que quedaron
 * en TikTok o en mensajes llevan a WhatsApp con la pregunta por ese taller ya
 * escrita; un taller que no existe, a la lista de talleres.
 */
const WorkshopRegistrationRedirect = async ({ params }: PageProps) => {
  const { slug } = await params;
  const edition = (await loadRegistrationEdition(slug).catch(() => null)) ??
    (await currentSlugForPrevious(slug).then((s) => (s ? loadRegistrationEdition(s) : null)).catch(() => null));
  if (!edition) redirect("/taller-virtual");
  redirect(buildWhatsAppUrl(workshopWhatsAppMessage(edition.title)));
};

export default WorkshopRegistrationRedirect;
