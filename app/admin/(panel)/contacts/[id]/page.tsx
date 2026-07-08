import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import ContactDetailClient from "@/app/components/admin/ContactDetailClient";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { getContactById } from "@/lib/crm/contacts";
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
import { isCrmUiPreview } from "@/lib/auth/preview";

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

  return (
    <CrmPageShell>
      <Link
        href="/admin/contacts"
        className="mb-3 inline-flex items-center gap-0.5 text-sm font-medium text-primary hover:opacity-75"
      >
        ← Contactos
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
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
        />
      </Suspense>
    </CrmPageShell>
  );
};

export default ContactDetailPage;
