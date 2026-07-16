import ContactsPageClient from "@/app/components/admin/crm/ContactsPageClient";
import { searchContacts } from "@/lib/crm/contacts";
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
  };

  if (preview) {
    return (
      <ContactsPageClient
        preview
        initialQ={q}
        filters={filters}
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

  let rows: Awaited<ReturnType<typeof searchContacts>> = [];
  try {
    rows = await searchContacts({
      q,
      limit: 80,
      countryIso: sp.country,
      source: (sp.source as ContactSource) || undefined,
      activeTherapy: sp.activeTherapy === "1",
    });
  } catch {
    rows = [];
  }

  return (
    <ContactsPageClient
      preview={false}
      initialQ={q}
      filters={filters}
      rows={rows.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        phoneE164: c.phoneE164,
        countryIso: c.countryIso,
        source: c.source,
        createdAt: c.createdAt.toISOString(),
        hasPayment: c.enrollments.some((en) => en.payments.length > 0),
        enrollments: c.enrollments.map((en) => ({
          status: en.status,
          product: { title: en.product.title },
        })),
      }))}
    />
  );
};

export default ContactsPage;
