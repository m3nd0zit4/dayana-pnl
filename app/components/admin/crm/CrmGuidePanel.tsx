"use client";

import { BookOpen, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const CrmGuidePanel = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-auto hidden border-t border-[var(--crm-border)] pt-3 lg:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] font-medium text-[var(--crm-muted)] transition-colors hover:bg-[var(--crm-linen)]/50 hover:text-[var(--crm-foreground)]"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          Cómo usar el CRM
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-2 space-y-2 px-2.5 pb-2 text-[11px] leading-relaxed text-[var(--crm-muted)]">
          <p className="font-medium text-[var(--crm-foreground)]">Flujo operativo</p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              <Link href="/admin/contacts" className="text-[var(--crm-accent)] hover:underline">
                Contactos
              </Link>{" "}
              → nuevo cliente
            </li>
            <li>Agregar servicio (terapia, curso o taller)</li>
            <li>
              Activar: pago web o estado{" "}
              <span className="text-[var(--crm-foreground)]">Activo</span>
            </li>
            <li>
              <Link href="/admin/calendar" className="text-[var(--crm-accent)] hover:underline">
                Calendario
              </Link>{" "}
              → agendar sesiones y Meet
            </li>
          </ol>
          <p className="text-[10px]">
            <strong className="text-[var(--crm-foreground)]">Enrollment</strong> = contrato del
            contacto con un producto.{" "}
            <strong className="text-[var(--crm-foreground)]">TherapyPackage</strong> se crea solo
            cuando la terapia está activa.
          </p>
          <p className="text-[10px]">
            Los servicios en estado <em>Lead</em> no aparecen en Terapias hasta activarlos.
          </p>
        </div>
      )}
    </div>
  );
};

export default CrmGuidePanel;
