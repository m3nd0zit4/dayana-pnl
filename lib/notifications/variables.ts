import type { Contact, Enrollment, Payment, Product, WorkshopEdition } from "@prisma/client";
import { siteUrl } from "./config";

export type TemplateVars = Record<string, string>;

export const contactVars = (contact: Contact): TemplateVars => ({
  first_name: contact.firstName,
  last_name: contact.lastName ?? "",
  display_name: contact.displayName ?? contact.firstName,
  phone: contact.phoneE164,
});

export const paymentVars = (
  contact: Contact,
  enrollment: Enrollment & { product: Product },
  payment: Payment
): TemplateVars => {
  const amount =
    payment.amountMinor / 100;
  const formatted = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: payment.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);

  return {
    ...contactVars(contact),
    product_title: enrollment.label ?? enrollment.product.title,
    payment_amount: formatted,
    payment_currency: payment.currency,
    payment_provider: payment.provider,
    payment_date: (payment.paidAt ?? new Date()).toLocaleDateString("es-CO", {
      dateStyle: "long",
    }),
    sessions_total: String(enrollment.sessionsTotal ?? enrollment.product.sessionsCount ?? ""),
    sessions_left: String(
      Math.max(
        0,
        (enrollment.sessionsTotal ?? enrollment.product.sessionsCount ?? 0) -
          enrollment.sessionsUsed
      )
    ),
    site_url: siteUrl(),
    admin_contact_url: `${siteUrl()}/admin/contacts/${contact.id}`,
    membership_paid_until: enrollment.paidUntil
      ? enrollment.paidUntil.toLocaleDateString("es-CO", { dateStyle: "long" })
      : "",
    portal_url: `${siteUrl()}/miembros`,
  };
};

export const workshopVars = (
  contact: Contact,
  edition: WorkshopEdition
): TemplateVars => {
  const baseUrl = siteUrl();
  const workshopUrl =
    edition.status === "OPEN"
      ? `${baseUrl}/taller-virtual/${edition.slug}`
      : `${baseUrl}/taller-virtual`;

  return {
    ...contactVars(contact),
    workshop_title: edition.title,
    workshop_edition: edition.editionLabel ?? "",
    workshop_date: edition.dateLabel ?? "",
    workshop_schedule: edition.scheduleLabel ?? "",
    workshop_summary: edition.cardSummary ?? "",
    workshop_url: workshopUrl,
  };
};
