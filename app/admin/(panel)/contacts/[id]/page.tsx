import type { ProductKind } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import ContactDetailClient from "@/app/components/admin/ContactDetailClient";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { getContactById } from "@/lib/crm/contacts";
import { isPlaceholderContactPhone } from "@/lib/crm/checkout-placeholder";
import { getActiveProducts } from "@/lib/crm/products";
import { isCrmUiPreview } from "@/lib/auth/preview";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const ContactDetailPage = async ({ params }: Props) => {
  const { id } = await params;

  if (isCrmUiPreview()) {
    redirect("/admin/contacts");
  }

  let contact;
  let products: { id: string; title: string; kind: ProductKind }[] = [];

  try {
    contact = await getContactById(id);
    const prods = await getActiveProducts();
    products = prods.map((p) => ({
      id: p.id,
      title: p.title,
      kind: p.kind,
    }));
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
          products={products}
        />
      </Suspense>
    </CrmPageShell>
  );
};

export default ContactDetailPage;
