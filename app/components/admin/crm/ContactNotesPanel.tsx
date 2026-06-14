"use client";

import { Maximize2 } from "lucide-react";
import ContactNotebookPanel from "./notebook/ContactNotebookPanel";

type Props = {
  contactId: string;
  contactName?: string;
  initialPageId?: string | null;
  createOnMount?: boolean;
  initialTherapySessionId?: string | null;
  focusMode?: boolean;
  onEnterFocus?: () => void;
  onExitFocus?: () => void;
};

const ContactNotesPanel = ({
  contactId,
  contactName,
  initialPageId,
  createOnMount,
  initialTherapySessionId,
  focusMode = false,
  onEnterFocus,
  onExitFocus,
}: Props) => {
  return (
    <div
      id="cuaderno-clinico"
      className={focusMode ? "crm-focus-notes flex min-h-0 flex-1 flex-col" : "space-y-2 scroll-mt-6"}
    >
      {!focusMode && (
        <div className="crm-notebook-section-header">
          <h2 className="text-xs font-medium text-[var(--crm-muted)]">
            Cuaderno{contactName ? ` · ${contactName}` : ""}
          </h2>
          {onEnterFocus && (
            <button
              type="button"
              className="crm-btn-icon size-7"
              aria-label="Modo enfoque"
              title="Modo enfoque"
              onClick={onEnterFocus}
            >
              <Maximize2 className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <ContactNotebookPanel
        contactId={contactId}
        initialPageId={initialPageId}
        createOnMount={createOnMount}
        initialTherapySessionId={initialTherapySessionId}
        focusMode={focusMode}
        patientLabel={contactName}
        onExitFocus={onExitFocus}
      />
    </div>
  );
};

export default ContactNotesPanel;
