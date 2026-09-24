import { notFound } from "next/navigation";

import CrmPageHeader from "@/app/components/admin/crm/CrmPageHeader";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import PeopleWhatsAppList from "@/app/components/admin/whatsapp/PeopleWhatsAppList";
import WhatsAppBulkSend from "@/app/components/admin/whatsapp/WhatsAppBulkSend";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { prisma } from "@/lib/db";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { workshopPresets } from "@/lib/crm/whatsapp-presets";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  ACTIVE: "Activa",
  COMPLETED: "Terminó",
  PENDING_PAYMENT: "Pendiente de pago",
  LEAD: "Interesada",
};

/**
 * WhatsApp de un taller: las personas inscritas en la edición (con su estado
 * de WhatsApp y envío a una, a varias o a todas) y la invitación a quienes
 * aceptaron recibir novedades.
 */
const Page = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  if (isCrmUiPreview()) return null;
  const edition = await prisma.workshopEdition.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      slug: true,
      startsAt: true,
      dateLabel: true,
      meetingUrl: true,
      enrollments: {
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          contact: { select: { id: true, firstName: true, lastName: true, phoneE164: true, email: true } },
        },
      },
    },
  });
  if (!edition) notFound();

  const tz = await getOperationalTimezone();
  const presets = workshopPresets(edition, tz);
  const seen = new Set<string>();
  const people = edition.enrollments
    .filter((e) => (seen.has(e.contact.id) ? false : (seen.add(e.contact.id), true)))
    .map((e) => ({
      contactId: e.contact.id,
      name: [e.contact.firstName, e.contact.lastName].filter(Boolean).join(" "),
      detail: [STATUS[e.status] ?? e.status, e.contact.phoneE164.startsWith("+nophone") ? "sin número" : e.contact.phoneE164, e.contact.email]
        .filter(Boolean)
        .join(" · "),
    }));

  // Invitación: contactos que aceptaron recibir novedades y no están inscritos.
  const marketing = await prisma.contact.findMany({
    where: {
      consentMarketingAt: { not: null },
      notifyWhatsapp: true,
      NOT: { phoneE164: { startsWith: "+nophone" } },
      id: { notIn: [...seen] },
    },
    select: { id: true },
    take: 2000,
  });

  return (
    <CrmPageShell>
      <CrmPageHeader
        title={`WhatsApp · ${edition.title}`}
        backHref="/admin/workshops"
        backLabel="Talleres"
        description={`${people.length} inscritas en esta edición`}
      />

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e9edef] bg-white p-4 dark:border-border dark:bg-card">
        <div className="min-w-0 flex-1">
          <div className="font-medium">Invitar al taller</div>
          <div className="text-xs text-muted-foreground">
            {marketing.length} contactos aceptaron recibir novedades y todavía no están inscritos.
          </div>
        </div>
        <WhatsAppBulkSend
          contactIds={marketing.map((m) => m.id)}
          presets={presets}
          kind="taller"
          title={`Taller: ${edition.title} (invitación)`}
          label="Invitar por WhatsApp"
        />
      </section>

      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay inscritas en esta edición.</p>
      ) : (
        <PeopleWhatsAppList
          people={people}
          allContactIds={people.map((p) => p.contactId)}
          presets={presets}
          kind="taller"
          title={`Taller: ${edition.title}`}
          source="talleres"
          allLabel="Enviar a todas las inscritas"
        />
      )}
    </CrmPageShell>
  );
};

export default Page;
