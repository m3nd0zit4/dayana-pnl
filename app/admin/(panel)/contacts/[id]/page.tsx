import type { ProductKind } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import ContactDetailClient from "@/app/components/admin/ContactDetailClient";
import CrmPageShell from "@/app/components/admin/crm/CrmPageShell";
import { getContactById } from "@/lib/crm/contacts";
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

  return (
    <CrmPageShell>
      <Link
        href="/admin/contacts"
        className="mb-6 inline-flex text-xs font-medium text-[var(--crm-accent)] hover:underline"
      >
        ← Contactos
      </Link>
      <Suspense fallback={<p className="text-sm text-[var(--crm-muted)]">Cargando…</p>}>
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
