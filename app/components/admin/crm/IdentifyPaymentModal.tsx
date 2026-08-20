"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import ContactPickerField, { type PickerContact } from "./ContactPickerField";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  paymentId: string;
  /** Sólo informativo: ayuda a reconocer de qué cobro se trata. */
  summary: string;
  onSuccess: (contact: PickerContact) => void;
};

/**
 * Pone nombre a un pago que llegó sin datos del pagador.
 *
 * Pasa cuando el proveedor no reporta email ni teléfono —efectivo en Mercado
 * Pago, o alguien pagando desde la cuenta de otra persona—: el cobro queda
 * colgando de una ficha temporal y en el panel se ve como «sin identificar».
 * Aquí se elige la ficha real y la matrícula entera —con su pago— se mueve.
 */
const IdentifyPaymentModal = ({
  open,
  onClose,
  paymentId,
  summary,
  onSuccess,
}: Props) => {
  const { toast } = useCrm();
  const [contact, setContact] = useState<PickerContact | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setContact(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast(
          data?.error === "CONTACT_NOT_FOUND"
            ? "Ese contacto ya no existe."
            : "No se pudo asignar el contacto.",
          "error"
        );
        return;
      }
      onSuccess(contact);
      toast("Pago asignado al contacto.", "success");
      onClose();
    } catch {
      toast("No se pudo asignar el contacto.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CrmModal open={open} title="Identificar pago" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {summary}
        </p>
        <p className="text-sm text-muted-foreground">
          El servicio y el pago se mueven a la ficha que elijas. La ficha
          temporal se elimina si no le queda nada más.
        </p>

        <ContactPickerField
          id="identify-payment-contact"
          label="Contacto"
          value={contact?.id ?? ""}
          onSelect={setContact}
          required
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !contact}>
            {busy ? "Asignando…" : "Asignar contacto"}
          </Button>
        </div>
      </div>
    </CrmModal>
  );
};

export default IdentifyPaymentModal;
