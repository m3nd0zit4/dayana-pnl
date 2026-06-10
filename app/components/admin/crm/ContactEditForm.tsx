"use client";

import { useState } from "react";
import type { ContactSource } from "@prisma/client";
import { contactToFormValues, type ContactFormValues } from "@/app/config/contact-form";
import ContactFormFields from "./ContactFormFields";

type Contact = {
  id: string;
  phoneE164: string;
  phoneCountryIso: string | null;
  firstName: string;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  countryIso: string | null;
  timezone: string;
  preferredLocale: string;
  source: ContactSource;
  sourceDetail: string | null;
  tiktokHandle: string | null;
  notes: string | null;
  consentDataAt: Date | null;
  consentMarketingAt: Date | null;
};

const ContactEditForm = ({ contact }: { contact: Contact }) => {
  const [values, setValues] = useState<ContactFormValues>(() =>
    contactToFormValues(contact)
  );
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<ContactFormValues>) =>
    setValues((v) => ({ ...v, ...p }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);
    const res = await fetch(`/api/admin/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: values.firstName,
        lastName: values.lastName || null,
        displayName: values.displayName || null,
        email: values.email || null,
        countryIso: values.countryIso || null,
        timezone: values.timezone,
        preferredLocale: values.preferredLocale,
        source: values.source,
        sourceDetail: values.sourceDetail || null,
        tiktokHandle: values.tiktokHandle || null,
        notes: values.notes || null,
        consentData: values.consentData,
        consentMarketing: values.consentMarketing,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("No se pudieron guardar los cambios.");
      return;
    }
    setSaved(true);
  };

  return (
    <form
      onSubmit={save}
      className="crm-surface-card mb-8 space-y-4 border-l-4 border-l-[var(--crm-blush)] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="crm-section-title text-sm">Datos del contacto</h2>
      </div>
      <ContactFormFields values={values} onChange={patch} mode="edit" />
      {error && (
        <p className="text-sm text-[var(--crm-danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="crm-btn-primary" disabled={loading}>
          {loading ? "Guardando…" : "Guardar cambios"}
        </button>
        {saved && (
          <span className="text-sm text-[var(--crm-success)]">Guardado</span>
        )}
      </div>
    </form>
  );
};

export default ContactEditForm;
