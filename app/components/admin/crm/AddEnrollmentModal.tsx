"use client";

import { EnrollmentStatus } from "@prisma/client";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import CrmModal from "./CrmModal";
import SearchableSelect from "./SearchableSelect";
import { useCrm } from "./CrmProvider";
import { useActiveProducts } from "./hooks/useReferenceData";
import { productSelectOptions } from "@/lib/crm/form-select-options";
import { groupProductsByKind } from "@/lib/crm/product-kind-labels";
import type { SelectOption } from "@/lib/crm/select-option";

type Props = {
  open: boolean;
  onClose: () => void;
  contactId: string;
  onSuccess?: (enrollmentId: string) => void;
};

const STATUS_OPTIONS: SelectOption[] = [
  { value: EnrollmentStatus.ACTIVE, label: "Activo — ya pagó fuera de la plataforma" },
  { value: EnrollmentStatus.PENDING_PAYMENT, label: "Pago pendiente" },
  { value: EnrollmentStatus.LEAD, label: "Lead / por confirmar" },
];

const AddEnrollmentModal = ({ open, onClose, contactId, onSuccess }: Props) => {
  const { toast } = useCrm();
  const { products } = useActiveProducts(open);
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState<string>(EnrollmentStatus.ACTIVE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productGroups = groupProductsByKind(products);

  // Transiciones open/close y producto por defecto resueltos durante el
  // render (sin efecto), mismo patrón que ContactFormModal.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setProductId("");
      setStatus(EnrollmentStatus.ACTIVE);
      setError(null);
      setBusy(false);
    }
  }

  if (open && !productId && productGroups.length > 0) {
    setProductId(productGroups[0].items[0].id);
  }

  const submit = async () => {
    if (!productId) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactId, productId, status }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      enrollment?: { id: string };
    };
    if (!res.ok) {
      setError(
        data.error === "DUPLICATE_SERVICE"
          ? "Este contacto ya tiene ese servicio pendiente."
          : data.error === "ACTIVE_THERAPY_EXISTS"
            ? "Este contacto ya tiene otra terapia activa."
            : data.error === "THERAPY_MISSING_SESSIONS"
              ? "Ese producto de terapia no tiene sesiones configuradas."
              : "No se pudo agregar el servicio."
      );
      return;
    }
    toast("Servicio agregado");
    if (data.enrollment) onSuccess?.(data.enrollment.id);
    onClose();
  };

  return (
    <CrmModal title="Agregar servicio" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {productGroups.length === 0 ? (
          <p className="text-muted-foreground">
            No hay productos activos en el catálogo. Crea uno primero en Productos.
          </p>
        ) : (
          <>
            <SearchableSelect
              id="add-enr-product"
              label="Servicio"
              value={productId}
              options={productSelectOptions(products)}
              onChange={setProductId}
              searchPlaceholder="Buscar servicio…"
            />
            <SearchableSelect
              id="add-enr-status"
              label="Estado"
              value={status}
              options={STATUS_OPTIONS}
              onChange={setStatus}
            />
            <p className="text-xs text-muted-foreground">
              Si ya pagó fuera de la plataforma (efectivo, transferencia…), deja{" "}
              <strong className="font-medium text-foreground">Activo</strong> y luego registra el
              pago desde la lista de servicios.
            </p>
          </>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {productGroups.length > 0 && (
            <Button onClick={() => void submit()} disabled={busy || !productId}>
              {busy ? "Agregando…" : "Agregar servicio"}
            </Button>
          )}
        </div>
      </div>
    </CrmModal>
  );
};

export default AddEnrollmentModal;
