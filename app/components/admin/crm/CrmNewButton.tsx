"use client";

import { Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";

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
  <Button size="sm" onClick={onClick} disabled={disabled} className={className}>
    <Plus strokeWidth={2} aria-hidden />
    <span className="hidden sm:inline">{label}</span>
  </Button>
);

export default CrmNewButton;
