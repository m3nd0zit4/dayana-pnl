"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  large?: boolean;
};

const CrmModal = ({ title, open, onClose, children, large }: Props) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="crm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crm-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`crm-modal ${large ? "crm-modal-lg" : ""}`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id="crm-modal-title" className="crm-section-title text-base">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="crm-btn-icon size-8 shrink-0"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export default CrmModal;
