import { ContactSource, EnrollmentStatus } from "@prisma/client";
import { CONTACT_SOURCE_OPTIONS } from "@/app/config/contact-form";
import { ENROLLMENT_STATUS_LABEL } from "@/lib/crm/enrollment-labels";
import type { SelectOption } from "@/lib/crm/select-option";

import {
  groupProductsByKind,
  type ProductOption,
} from "@/lib/crm/product-kind-labels";

export const contactSourceSelectOptions = (): SelectOption[] =>
  CONTACT_SOURCE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

/**
 * The contacts-list filter, unlike the create/edit form, must also let staff
 * isolate WEB_LEAD_FORM (home "Hablemos sin prisa" submissions, badged
 * "Contacto pendiente") — a system-assigned source nobody picks manually,
 * so it's deliberately absent from CONTACT_SOURCE_OPTIONS.
 */
export const contactFilterSourceSelectOptions = (): SelectOption[] => [
  ...contactSourceSelectOptions(),
  { value: "WEB_LEAD_FORM" satisfies ContactSource, label: "Formulario web (lead)" },
];

export const enrollmentStatusSelectOptions = (
  includeAll = false
): SelectOption[] => {
  const statuses = Object.values(EnrollmentStatus);
  const opts = statuses.map((s) => ({
    value: s,
    label: ENROLLMENT_STATUS_LABEL[s],
  }));
  if (includeAll) {
    return [{ value: "all", label: "Todos los estados" }, ...opts];
  }
  return opts;
};

export const productSelectOptions = (
  products: ProductOption[]
): SelectOption[] => {
  const groups = groupProductsByKind(products);
  return groups.flatMap((g) =>
    g.items.map((p) => ({
      value: p.id,
      label: p.title,
      group: g.label,
    }))
  );
};

export const contactSelectOptions = (
  contacts: { id: string; firstName: string; lastName: string | null; phoneE164?: string }[]
): SelectOption[] =>
  contacts.map((c) => ({
    value: c.id,
    label: `${c.firstName} ${c.lastName ?? ""}`.trim(),
    hint: c.phoneE164,
  }));

export const workshopSelectOptions = (
  workshops: { id: string; title: string }[],
  allowEmpty = true
): SelectOption[] => {
  const opts = workshops.map((w) => ({
    value: w.id,
    label: w.title,
  }));
  return allowEmpty
    ? [{ value: "", label: "Sin edición específica" }, ...opts]
    : opts;
};
