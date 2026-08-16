import ContactsPageClient from "@/app/components/admin/crm/ContactsPageClient";
import { countContacts, searchContacts } from "@/lib/crm/contacts";
import { PREVIEW_CONTACTS } from "@/lib/crm/preview-data";
import { isCrmUiPreview } from "@/lib/auth/preview";
import type { ContactSource } from "@prisma/client";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    q?: string;
    country?: string;
    source?: string;
    activeTherapy?: string;
    notes?: string;
  }>;
};

const ContactsPage = async ({ searchParams }: Props) => {
  const sp = await searchParams;
  const q = sp.q ?? "";
  const preview = isCrmUiPreview();
  const filters = {
    country: sp.country ?? "",
    source: sp.source ?? "",
    activeTherapy: sp.activeTherapy === "1",
    searchNotes: sp.notes === "1",
  };

  if (preview) {
    return (
      <ContactsPageClient
        preview
        initialQ={q}
        filters={filters}
        initialCursor={null}
        total={PREVIEW_CONTACTS.length}
        rows={PREVIEW_CONTACTS.map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          phoneE164: c.phoneE164,
          countryIso: null,
          source: "WEB",
          createdAt: new Date().toISOString(),
          hasPayment: true,
          enrollments: c.enrollments.map((en) => ({
            status: "ACTIVE",
            product: { title: en.product.title },
          })),
        }))}
      />
    );
  }

  const search = {
    q,
    countryIso: sp.country,
    source: (sp.source as ContactSource) || undefined,
    activeTherapy: sp.activeTherapy === "1",
    searchNotes: filters.searchNotes,
  };

  let page: Awaited<ReturnType<typeof searchContacts>> = {
    items: [],
    nextCursor: null,
  };
  let total = 0;
  try {
    // El recuento comparte `buildContactWhere` con la lista, así que la
    // cabecera no puede desviarse de lo que se muestra.
    [page, total] = await Promise.all([
      searchContacts(search),
      countContacts(search),
    ]);
  } catch {
    page = { items: [], nextCursor: null };
    total = 0;
  }

  return (
    <ContactsPageClient
      preview={false}
      initialQ={q}
      filters={filters}
      rows={page.items}
      initialCursor={page.nextCursor}
      total={total}
    />
  );
};

export default ContactsPage;
