"use client";

import { EnrollmentStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import {
  emptyContactForm,
  type ContactFormValues,
} from "@/app/config/contact-form";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import {
  groupProductsByKind,
  type ProductOption,
} from "@/lib/crm/product-kind-labels";
import { getCountryByIso } from "@/lib/countries";
import { inferLocaleFromPhone } from "@/lib/contact-timezone";
import { getLocalPhonePlaceholder } from "@/lib/phone";
import type { CountryCode } from "libphonenumber-js";
import ContactFormFields from "./ContactFormFields";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";

type Step = "contact" | "service";

type SavedResult = {
  contactId: string;
  enrollmentId?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (result?: SavedResult) => void;
};

const ContactFormModal = ({ open, onClose, onSaved }: Props) => {
  const [step, setStep] = useState<Step>("contact");
  const [values, setValues] = useState<ContactFormValues>(emptyContactForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdContactId, setCreatedContactId] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState("");
  const [activateNow, setActivateNow] = useState(false);

  const patch = (p: Partial<ContactFormValues>) =>
    setValues((v) => ({ ...v, ...p }));

  const reset = () => {
    setStep("contact");
    setValues(emptyContactForm);
    setError(null);
    setCreatedContactId(null);
    setProductId("");
    setActivateNow(false);
    setProducts([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const submitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const countryIso = values.countryIso || values.phoneCountry || "CO";
    const inferred = inferLocaleFromPhone(values.phone ?? "", countryIso);
    if (!inferred) {
      const country = getCountryByIso(countryIso);
      const example = getLocalPhonePlaceholder(countryIso as CountryCode);
      setError(
        country
          ? `Teléfono inválido. En País ya está ${country.dialCode}; escribe solo el móvil, ej. ${example}.`
          : "Teléfono inválido. Escribe solo el móvil local, sin +."
      );
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: inferred.phoneE164,
        phoneCountry: inferred.phoneCountry,
        firstName: values.firstName,
        lastName: values.lastName || undefined,
        email: values.email || undefined,
        countryIso: inferred.countryIso,
        timezone: values.timezone,
        preferredLocale: values.preferredLocale,
        source: values.source,
        sourceDetail: values.sourceDetail || undefined,
        notes: values.notes || undefined,
        consentData: values.consentData,
        consentMarketing: values.consentMarketing,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === "invalid_phone"
          ? "Teléfono inválido. Usa formato internacional (+57…, +34…)."
          : "No se pudo guardar el contacto."
      );
      return;
    }
    const data = (await res.json()) as { contact: { id: string } };
    setCreatedContactId(data.contact.id);

    const prodRes = await fetch("/api/admin/products");
    const prodData = (await prodRes.json()) as {
      products?: (ProductOption & { isActive: boolean })[];
    };
    const active = (prodData.products ?? []).filter((p) => p.isActive);
    setProducts(active);
    const groups = groupProductsByKind(active);
    const first = groups[0]?.items[0];
    if (first) setProductId(first.id);
    setStep("service");
  };

  const finishWithoutService = () => {
    const id = createdContactId;
    reset();
    onClose();
    if (id) onSaved({ contactId: id });
  };

  const submitService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdContactId || !productId) {
      finishWithoutService();
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactId: createdContactId,
        productId,
        status: activateNow ? EnrollmentStatus.ACTIVE : EnrollmentStatus.LEAD,
      }),
    });
    setLoading(false);
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      enrollment?: { id: string };
    };
    if (!res.ok) {
      setError(
        data.error === "ACTIVE_THERAPY_EXISTS"
          ? "Este contacto ya tiene una terapia activa."
          : data.error === "THERAPY_MISSING_SESSIONS"
            ? "El producto de terapia no tiene número de sesiones configurado."
            : "No se pudo crear el servicio."
      );
      return;
    }
    const contactId = createdContactId;
    const enrollmentId = data.enrollment?.id;
    reset();
    onClose();
    onSaved({ contactId, enrollmentId });
  };

  const productGroups = groupProductsByKind(products);

  return (
    <CrmModal
      title={step === "contact" ? "Nuevo contacto" : "¿Agregar servicio?"}
      open={open}
      onClose={handleClose}
      large
    >
      {step === "contact" ? (
        <form className="space-y-4" onSubmit={submitContact}>
          <ContactFormFields values={values} onChange={patch} mode="create" />
          {error && (
            <p className="text-sm text-[var(--crm-danger)]" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="crm-btn-secondary" onClick={handleClose}>
              Cancelar
            </button>
            <button type="submit" className="crm-btn-primary" disabled={loading}>
              {loading ? "Guardando…" : "Crear contacto"}
            </button>
          </div>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={submitService}>
          <p className="text-sm text-[var(--crm-muted)]">
            Contacto creado. Puedes vincular un producto ahora o hacerlo después desde la ficha.
          </p>
          {productGroups.length > 0 ? (
            <>
              <SearchableSelect
                id="cf-product"
                label="Producto"
                value={productId}
                options={productSelectOptions(products)}
                onChange={setProductId}
                searchPlaceholder="Buscar producto…"
              />
              <label className="flex items-center gap-2 text-sm text-[var(--crm-muted)]">
                <input
                  type="checkbox"
                  checked={activateNow}
                  onChange={(e) => setActivateNow(e.target.checked)}
                />
                Activar ya (terapia → aparece en Terapias con paquete de sesiones)
              </label>
            </>
          ) : (
            <p className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-linen)]/30 p-3 text-sm text-[var(--crm-muted)]">
              No hay productos activos en el catálogo. Crea uno en Productos o continúa sin
              servicio.
            </p>
          )}
          {error && (
            <p className="text-sm text-[var(--crm-danger)]" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              className="crm-btn-secondary"
              onClick={finishWithoutService}
            >
              Omitir por ahora
            </button>
            {productGroups.length > 0 && (
              <button type="submit" className="crm-btn-primary" disabled={loading}>
                {loading ? "Creando…" : "Crear servicio"}
              </button>
            )}
          </div>
        </form>
      )}
    </CrmModal>
  );
};

export default ContactFormModal;
