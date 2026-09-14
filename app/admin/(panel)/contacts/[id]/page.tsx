import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import ContactDetailClient from "@/app/components/admin/ContactDetailClient";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import CrmLoadingState from "@/app/components/admin/crm/ui/CrmLoadingState";
import { getContactById } from "@/lib/crm/contacts";
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { listDiagnosticsForContact } from "@/lib/crm/diagnostics";
import {
  getOperationalTimezone,
  OPERATIONAL_TZ,
} from "@/lib/crm/operational-timezone";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const ContactDetailPage = async ({ params }: Props) => {
  const { id } = await params;

  if (isCrmUiPreview()) {
    redirect("/admin/contacts");
  }

  let contact;

  try {
    contact = await getContactById(id);
  } catch {
    notFound();
  }

  if (!contact) notFound();
  if (isPlaceholderContactPhone(contact.phoneE164)) {
    redirect("/admin/contacts");
  }

  // Los diagnósticos completados de la persona: la ficha muestra el último en
  // la pestaña Resumen (ver ContactDetailClient).
  // Si la consulta falla, la ficha se abre igual, sin la tarjeta: los
  // diagnósticos son un complemento y no deben tumbar la página del contacto.
  const [diagnostics, timeZone] = await Promise.all([
    listDiagnosticsForContact(contact.id).catch(() => []),
    getOperationalTimezone().catch(() => OPERATIONAL_TZ),
  ]);

  // El enlace «volver» ya no vive aquí: lo pinta CrmPageHeader dentro del
  // cliente, que es quien tiene el nombre del contacto para el título.
  return (
    <CrmPageShell>
      <Suspense fallback={<CrmLoadingState rows={3} variant="card" />}>
        <ContactDetailClient
          contact={{
            ...contact,
            enrollments: contact.enrollments.map((en) => ({
              ...en,
              payments: en.payments.map((p) => ({
                ...p,
                createdAt: p.createdAt.toISOString(),
              })),
            })),
          }}
          diagnostics={diagnostics}
          timeZone={timeZone}
        />
      </Suspense>
    </CrmPageShell>
  );
};

export default ContactDetailPage;
