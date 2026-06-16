"use client";

type Props = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

const CrmConfirmDialog = ({ open, title, message, onClose, onConfirm }: Props) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crm-confirm-title"
    >
      <div className="crm-surface-card w-full max-w-md p-6 shadow-xl">
        <h2 id="crm-confirm-title" className="crm-section-title text-base">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[var(--crm-muted)]">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="crm-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="crm-btn-primary"
            onClick={() => void onConfirm()}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
};

export default CrmConfirmDialog;
