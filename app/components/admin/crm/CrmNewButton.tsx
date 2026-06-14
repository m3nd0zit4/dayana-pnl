"use client";

import { Plus } from "lucide-react";

type Props = {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

/** Botón «Nuevo» compacto para headers de página (mismo tamaño en todo el CRM). */
const CrmNewButton = ({
  label = "Nuevo",
  onClick,
  disabled = false,
  className = "",
}: Props) => (
  <button
    type="button"
    className={`crm-btn-primary crm-btn-compact${className ? ` ${className}` : ""}`}
    onClick={onClick}
    disabled={disabled}
  >
    <Plus className="size-4" strokeWidth={2} aria-hidden />
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export default CrmNewButton;
