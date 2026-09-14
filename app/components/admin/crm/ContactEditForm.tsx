"use client";

import { useState } from "react";
import type { ContactSource } from "@prisma/client";
import { contactToFormValues, type ContactFormValues } from "@/app/config/contact-form";
import { hasRealContactPhone } from "@/lib/crm/contact-phone";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import ContactFormFields from "./ContactFormFields";
import { useCrm } from "./CrmProvider";
import { CrmFormActions } from "./ui";

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

type Props = {
  contact: Contact;
  /** Vuelve a la vista de solo lectura sin guardar. */
  onCancel?: () => void;
  /** Tras guardar: la ficha refresca y vuelve a la vista de solo lectura. */
  onSaved?: () => void;
};

/**
 * Edición de los datos de un contacto.
 *
 * Antes era la vista por defecto de la ficha: catorce campos abiertos para
 * mirar un teléfono. Ahora se abre con «Editar» y, al guardar, confirma con un
 * aviso (regla R9) en vez de un «Guardado» verde pegado al botón.
 */
const ContactEditForm = ({ contact, onCancel, onSaved }: Props) => {
  const { toast } = useCrm();
  // Cuenta creada con Google/correo: el "teléfono" es un placeholder
  // (+google:/+signup:) — arrancar el campo vacío y permitir capturarlo.
  const phoneMissing = !hasRealContactPhone(contact.phoneE164);
  const [values, setValues] = useState<ContactFormValues>(() => {
    const initial = contactToFormValues(contact);
    return phoneMissing ? { ...initial, phone: "" } : initial;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<ContactFormValues>) => {
    setValues((v) => ({ ...v, ...p }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(phoneMissing && values.phone?.trim()
          ? { phone: values.phone, phoneCountry: values.phoneCountry }
          : {}),
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === "phone_taken"
          ? "Ese número ya pertenece a otro contacto."
          : data.error === "invalid_phone"
            ? "El teléfono no es válido para el país elegido."
            : "No se pudieron guardar los cambios."
      );
      return;
    }
    toast("Cambios guardados");
    onSaved?.();
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <h2 className="text-sm font-semibold">Editar datos</h2>
          <ContactFormFields
            values={values}
            onChange={patch}
            mode="edit"
            allowPhoneEdit={phoneMissing}
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <CrmFormActions>
            {onCancel ? (
              <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                Cancelar
              </Button>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar cambios"}
            </Button>
          </CrmFormActions>
        </form>
      </CardContent>
    </Card>
  );
};

export default ContactEditForm;
