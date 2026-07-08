"use client";

import { useState } from "react";
import type { ContactSource } from "@prisma/client";
import { contactToFormValues, type ContactFormValues } from "@/app/config/contact-form";
import type { ExtractedContactFields } from "@/lib/ai/contact-extraction";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import ContactFormFields from "./ContactFormFields";
import SmartPasteBox from "./SmartPasteBox";
import { useCrm } from "./CrmProvider";

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
  const { aiEnabled } = useCrm();
  const [values, setValues] = useState<ContactFormValues>(() =>
    contactToFormValues(contact)
  );
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiFilled, setAiFilled] = useState<ReadonlySet<string>>(new Set());

  const patch = (p: Partial<ContactFormValues>) => {
    setValues((v) => ({ ...v, ...p }));
    setAiFilled((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const key of Object.keys(p)) next.delete(key);
      return next.size === prev.size ? prev : next;
    });
  };

  const applyAiFields = (fields: ExtractedContactFields) => {
    const p: Partial<ContactFormValues> = {};
    if (fields.firstName) p.firstName = fields.firstName;
    if (fields.lastName) p.lastName = fields.lastName;
    if (fields.email) p.email = fields.email;
    if (fields.countryIso) p.countryIso = fields.countryIso;
    if (fields.preferredLocale) p.preferredLocale = fields.preferredLocale;
    if (fields.source) p.source = fields.source;
    if (fields.sourceDetail) p.sourceDetail = fields.sourceDetail;
    if (fields.notes) p.notes = fields.notes;

    setValues((v) => ({ ...v, ...p }));
    setAiFilled(new Set(Object.keys(p)));
  };

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
    <Card className="mb-8 border-l-4 border-l-accent">
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <h2 className="text-sm font-semibold">Datos del contacto</h2>
          {aiEnabled && (
            <SmartPasteBox onExtracted={applyAiFields} />
          )}
          <ContactFormFields
            values={values}
            onChange={patch}
            mode="edit"
            aiFilled={aiFilled}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar cambios"}
            </Button>
            {saved && <span className="text-sm text-green-700">Guardado</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default ContactEditForm;
