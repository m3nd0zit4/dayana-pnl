"use client";

import { EnrollmentStatus } from "@prisma/client";
import { useState } from "react";
import {
  enrollmentStatusSelectOptions,
  productSelectOptions,
  workshopSelectOptions,
} from "@/lib/crm/form-select-options";
import { groupProductsByKind } from "@/lib/crm/product-kind-labels";
import ContactPickerField from "./ContactPickerField";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";
import {
  useActiveProducts,
  useWorkshopEditions,
} from "./hooks/useReferenceData";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  preselectedContactId?: string;
  preselectedContactLabel?: string;
};

const EnrollmentFormModal = ({
  open,
  onClose,
  onSaved,
  preselectedContactId,
  preselectedContactLabel,
}: Props) => {
  const { products } = useActiveProducts(open);
  const { workshops } = useWorkshopEditions(open);
  const [contactId, setContactId] = useState(preselectedContactId ?? "");
  const [productId, setProductId] = useState("");
  const [workshopEditionId, setWorkshopEditionId] = useState("");
  const [status, setStatus] = useState<EnrollmentStatus>(EnrollmentStatus.LEAD);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset al abrir + producto por defecto al llegar la lista — ajuste de
  // estado durante el render, sin efectos.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setContactId(preselectedContactId ?? "");
      setError(null);
    }
  }

  if (open && !productId) {
    const first = groupProductsByKind(products)[0]?.items[0];
    if (first) setProductId(first.id);
  }

  const selectedProduct = products.find((p) => p.id === productId);
  const showWorkshop = selectedProduct?.kind === "WORKSHOP";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId || !productId) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactId,
        productId,
        workshopEditionId: showWorkshop && workshopEditionId ? workshopEditionId : undefined,
        status,
        label: label || undefined,
      }),
    });
    setLoading(false);
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(
        data.error === "ACTIVE_THERAPY_EXISTS"
          ? "Ya hay una terapia activa para este contacto."
          : data.error === "THERAPY_MISSING_SESSIONS"
            ? "El producto de terapia no tiene sesiones configuradas."
            : "No se pudo crear el servicio."
      );
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <CrmModal title="Nuevo servicio (enrollment)" open={open} onClose={onClose} large>
      <form className="space-y-4" onSubmit={submit}>
        <ContactPickerField
          id="en-contact"
          label="Contacto *"
          value={contactId}
          onSelect={(c) => setContactId(c?.id ?? "")}
          initialContact={
            preselectedContactId
              ? {
                  id: preselectedContactId,
                  label: preselectedContactLabel ?? "Contacto seleccionado",
                }
              : null
          }
          required
        />
        <SearchableSelect
          id="en-product"
          label="Producto *"
          value={productId}
          options={productSelectOptions(products)}
          onChange={setProductId}
          searchPlaceholder="Buscar producto…"
          required
        />
        {showWorkshop && workshops.length > 0 && (
          <SearchableSelect
            id="en-ws"
            label="Edición de taller"
            value={workshopEditionId}
            options={workshopSelectOptions(workshops)}
            onChange={setWorkshopEditionId}
            allowEmpty
            emptyLabel="Sin edición específica"
            searchMinOptions={99}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            id="en-status"
            label="Estado"
            value={status}
            options={enrollmentStatusSelectOptions()}
            onChange={(v) => setStatus(v as EnrollmentStatus)}
            panelMinWidth={200}
            searchMinOptions={99}
          />
          <div>
            <label className="crm-label" htmlFor="en-label">
              Etiqueta interna
            </label>
            <input
              id="en-label"
              className="crm-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>
        {error && (
          <p className="text-sm text-[var(--crm-danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="crm-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="crm-btn-primary" disabled={loading}>
            {loading ? "Creando…" : "Crear servicio"}
          </button>
        </div>
      </form>
    </CrmModal>
  );
};

export default EnrollmentFormModal;
