"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import AdminSignOut from "@/app/components/admin/AdminSignOut";
import CrmLogo from "./CrmLogo";
import CrmMenu from "./CrmMenu";

type Props = {
  open: boolean;
  onClose: () => void;
  preview?: boolean;
};

const CrmMobileDrawer = ({ open, onClose, preview = false }: Props) => {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="crm-drawer-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <aside
        id="crm-mobile-drawer"
        className="crm-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="crm-drawer-header">
          <CrmLogo />
          <button
            type="button"
            className="crm-btn-icon size-9"
            onClick={onClose}
            aria-label="Cerrar menú"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="crm-drawer-body">
          <CrmMenu showLabels onNavigate={onClose} />
        </div>
        {!preview && (
          <div className="crm-drawer-footer">
            <AdminSignOut />
            <span className="text-sm text-[var(--crm-muted)]">Cerrar sesión</span>
          </div>
        )}
      </aside>
    </div>,
    document.body
  );
};

export default CrmMobileDrawer;
