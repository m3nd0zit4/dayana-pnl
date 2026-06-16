"use client";

import { EnrollmentStatus } from "@prisma/client";
import { useEffect, useState } from "react";
import {
  contactSelectOptions,
  enrollmentStatusSelectOptions,
  productSelectOptions,
  workshopSelectOptions,
} from "@/lib/crm/form-select-options";
import {
  groupProductsByKind,
  type ProductOption,
} from "@/lib/crm/product-kind-labels";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";

type Workshop = { id: string; slug: string; title: string };
type Contact = {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  preselectedContactId?: string;
};

const EnrollmentFormModal = ({
  open,
  onClose,
  onSaved,
  preselectedContactId,
}: Props) => {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState(preselectedContactId ?? "");
  const [productId, setProductId] = useState("");
  const [workshopEditionId, setWorkshopEditionId] = useState("");
  const [status, setStatus] = useState<EnrollmentStatus>(EnrollmentStatus.LEAD);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContactId(preselectedContactId ?? "");
    setError(null);

    fetch("/api/admin/contacts/search?limit=200")
      .then((r) => r.json())
      .then((d: { contacts?: Contact[] }) => {
        const list = d.contacts ?? [];
        setContacts(list);
        if (!preselectedContactId && list[0]) setContactId(list[0].id);
      });

    fetch("/api/admin/products")
      .then((r) => r.json())
      .then((d: { products: (ProductOption & { isActive: boolean })[] }) => {
        const active = (d.products ?? []).filter((p) => p.isActive);
        setProducts(active);
        const groups = groupProductsByKind(active);
        const first = groups[0]?.items[0];
        if (first) setProductId(first.id);
      });

    fetch("/api/admin/workshops")
      .then((r) => r.json())
      .then((d: { editions: { id: string; slug: string; title: string }[] }) =>
        setWorkshops(d.editions ?? [])
      );
  }, [open, preselectedContactId]);

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
        <SearchableSelect
          id="en-contact"
          label="Contacto *"
          value={contactId}
          options={contactSelectOptions(contacts)}
          onChange={setContactId}
          placeholder="Seleccionar contacto…"
          searchPlaceholder="Buscar por nombre o teléfono…"
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
