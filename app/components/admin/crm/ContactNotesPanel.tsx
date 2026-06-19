"use client";

import { Maximize2, PenLine } from "lucide-react";
import dynamic from "next/dynamic";

const ContactNotebookPanel = dynamic(
  () => import("./notebook/ContactNotebookPanel"),
  {
    ssr: false,
    loading: () => (
      <div className="crm-notebook-canvas-loading" aria-busy="true">
        <div className="crm-notebook-canvas-loading-inner">
          <span className="crm-notebook-canvas-loading-bar" />
          <p>Preparando cuaderno…</p>
        </div>
      </div>
    ),
  }
);

type Props = {
  contactId: string;
  contactName?: string;
  focusMode?: boolean;
  notebookOpen?: boolean;
  onOpenNotebook?: () => void;
  onExitFocus?: () => void;
  onPreloadNotebook?: () => void;
};

const ContactNotesPanel = ({
  contactId,
  contactName,
  focusMode = false,
  notebookOpen = false,
  onOpenNotebook,
  onExitFocus,
  onPreloadNotebook,
}: Props) => {
  if (focusMode && notebookOpen) {
    return (
      <div
        id="cuaderno-clinico"
        className="crm-focus-notes flex min-h-0 flex-1 flex-col"
      >
        <ContactNotebookPanel
          contactId={contactId}
          focusMode
          patientLabel={contactName}
          onExitFocus={onExitFocus}
        />
      </div>
    );
  }

  return (
    <div id="cuaderno-clinico" className="space-y-2 scroll-mt-6">
      <div className="crm-notebook-section-header">
        <h2 className="text-xs font-medium text-[var(--crm-muted)]">
          Cuaderno{contactName ? ` · ${contactName}` : ""}
        </h2>
      </div>

      <div className="crm-notebook-placeholder">
        <div className="crm-notebook-placeholder-icon" aria-hidden>
          <PenLine className="size-8" strokeWidth={1.25} />
        </div>
        <p className="crm-notebook-placeholder-title">Cuaderno clínico</p>
        <p className="crm-notebook-placeholder-desc">
          Lienzo infinito para notas a mano. Se abre a pantalla completa para
          mejor rendimiento con lápiz en tablet.
        </p>
        {onOpenNotebook && (
          <button
            type="button"
            className="crm-btn-primary mt-4 inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            onClick={onOpenNotebook}
            onMouseEnter={onPreloadNotebook}
            onFocus={onPreloadNotebook}
          >
            <Maximize2 className="size-4" aria-hidden />
            Abrir cuaderno clínico
          </button>
        )}
      </div>
    </div>
  );
};

export default ContactNotesPanel;
