"use client";

import { EnrollmentStatus } from "@prisma/client";
import { useEffect, useRef, useState } from "react";
import {
  emptyContactForm,
  type ContactFormValues,
} from "@/app/config/contact-form";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import { groupProductsByKind } from "@/lib/crm/product-kind-labels";
import { getCountryByIso, suggestTimezoneForCountry } from "@/lib/countries";
import { inferLocaleFromPhone } from "@/lib/contact-timezone";
import { getLocalPhonePlaceholder } from "@/lib/phone";
import type { CountryCode } from "libphonenumber-js";
import type { ExtractedContactFields } from "@/lib/ai/contact-extraction";
import ContactFormFields from "./ContactFormFields";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";
import SmartPasteBox from "./SmartPasteBox";
import { useCrm } from "./CrmProvider";
import { useActiveProducts } from "./hooks/useReferenceData";

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

const DRAFT_KEY = "crm-contact-draft";
const DRAFT_DEBOUNCE_MS = 400;

const readDraft = (): ContactFormValues | null => {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ContactFormValues>;
    if (!parsed || typeof parsed !== "object") return null;
    return { ...emptyContactForm(), ...parsed };
  } catch {
    return null;
  }
};

const clearDraft = () => {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
};

const ContactFormModal = ({ open, onClose, onSaved }: Props) => {
  const { aiEnabled } = useCrm();
  const [step, setStep] = useState<Step>("contact");
  const [values, setValues] = useState<ContactFormValues>(emptyContactForm);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdContactId, setCreatedContactId] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [activateNow, setActivateNow] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [aiFilled, setAiFilled] = useState<ReadonlySet<string>>(new Set());
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Los productos solo se necesitan en el paso 2; la caché evita re-fetch
  // en cada apertura del modal.
  const { products } = useActiveProducts(open && step === "service");

  // La edición manual de un campo retira su resaltado de "sugerido por IA".
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
    if (fields.phone) p.phone = fields.phone;
    if (fields.countryIso) {
      p.countryIso = fields.countryIso;
      p.phoneCountry = fields.countryIso;
      p.timezone = suggestTimezoneForCountry(fields.countryIso);
    }
    if (fields.preferredLocale) p.preferredLocale = fields.preferredLocale;
    if (fields.source) p.source = fields.source;
    if (fields.sourceDetail) p.sourceDetail = fields.sourceDetail;
    if (fields.notes) p.notes = fields.notes;

    setValues((v) => ({ ...v, ...p }));
    setAiFilled(new Set(Object.keys(p)));
  };

  const reset = () => {
    setStep("contact");
    setValues(emptyContactForm);
    setError(null);
    setCreatedContactId(null);
    setProductId("");
    setActivateNow(false);
    setDraftRestored(false);
    setAiFilled(new Set());
    setPendingPaste(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Transiciones open/close resueltas durante el render (sin efecto):
  // al cerrar se limpia todo; al abrir se restaura el borrador si existe.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      reset();
    } else {
      const draft = readDraft();
      if (draft) {
        setValues(draft);
        setDraftRestored(true);
      }
    }
  }

  // Producto por defecto al llegar la lista en el paso 2.
  if (step === "service" && !productId) {
    const first = groupProductsByKind(products)[0]?.items[0];
    if (first) setProductId(first.id);
  }

  useEffect(() => {
    if (!open || step !== "contact") return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        const isEmpty =
          JSON.stringify(values) === JSON.stringify(emptyContactForm());
        if (isEmpty) sessionStorage.removeItem(DRAFT_KEY);
        else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(values));
      } catch {
        /* storage lleno o bloqueado — el borrador es best-effort */
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [values, open, step]);

  const discardDraft = () => {
    clearDraft();
    setValues(emptyContactForm());
    setDraftRestored(false);
  };

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
    clearDraft();
    setDraftRestored(false);
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
        <form
          className="space-y-4"
          onSubmit={submitContact}
          onPaste={(e) => {
            if (!aiEnabled) return;
            const target = e.target as HTMLElement;
            // Un pegado largo en cualquier campo ofrece el autocompletado.
            if (target.closest("[data-smart-paste]")) return;
            const pasted = e.clipboardData.getData("text");
            if (pasted.trim().length > 120) setPendingPaste(pasted);
          }}
        >
          {aiEnabled && (
            <div data-smart-paste>
              <SmartPasteBox
                onExtracted={applyAiFields}
                pendingText={pendingPaste}
                onConsumePendingText={() => setPendingPaste(null)}
              />
            </div>
          )}
          {aiFilled.size > 0 && (
            <p className="rounded-lg border border-purple-200 bg-purple-50/60 px-3 py-2 text-xs text-purple-900">
              Campos sugeridos por IA resaltados — revísalos antes de crear el
              contacto.
            </p>
          )}
          {draftRestored && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-linen)]/40 px-3 py-2 text-xs text-[var(--crm-muted)]">
              <span>Borrador restaurado — seguiste donde ibas.</span>
              <button
                type="button"
                className="crm-btn-ghost text-xs"
                onClick={discardDraft}
              >
                Descartar
              </button>
            </div>
          )}
          <ContactFormFields
            values={values}
            onChange={patch}
            mode="create"
            aiFilled={aiFilled}
          />
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
