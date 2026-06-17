"use client";

import { useEffect, useId, useState } from "react";

type Props = {
  open: boolean;
  contactName: string;
  phoneE164: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (phoneConfirm: string) => void | Promise<void>;
};

const DeleteContactDialog = ({
  open,
  contactName,
  phoneE164,
  busy,
  error,
  onClose,
  onConfirm,
}: Props) => {
  const inputId = useId();
  const [phoneConfirm, setPhoneConfirm] = useState("");

  useEffect(() => {
    if (!open) {
      setPhoneConfirm("");
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = phoneConfirm.trim().length > 0 && !busy;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-contact-title"
    >
      <div className="crm-surface-card w-full max-w-md p-6 shadow-xl">
        <h2 id="delete-contact-title" className="crm-section-title text-base">
          Eliminar contacto
        </h2>
        <p className="mt-2 text-sm text-[var(--crm-muted)]">
          Se borrará <span className="font-medium text-[var(--crm-foreground)]">{contactName}</span>{" "}
          y todo lo relacionado: servicios, pagos, cuaderno clínico, mensajes y
          notificaciones. Esta acción no se puede deshacer.
        </p>
        <p className="mt-3 text-sm">
          Escribe el teléfono{" "}
          <span className="font-mono font-semibold tabular-nums">{phoneE164}</span>{" "}
          para confirmar.
        </p>
        <label htmlFor={inputId} className="mt-4 block text-sm font-medium">
          Teléfono
        </label>
        <input
          id={inputId}
          type="tel"
          autoComplete="off"
          className="crm-input mt-1.5"
          placeholder={phoneE164}
          value={phoneConfirm}
          onChange={(e) => setPhoneConfirm(e.target.value)}
          disabled={busy}
        />
        {error && (
          <p className="mt-2 text-sm text-[var(--crm-danger)]" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="crm-btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="crm-btn-primary bg-[var(--crm-danger)] hover:opacity-90"
            disabled={!canSubmit}
            onClick={() => void onConfirm(phoneConfirm)}
          >
            {busy ? "Eliminando…" : "Eliminar contacto"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteContactDialog;
