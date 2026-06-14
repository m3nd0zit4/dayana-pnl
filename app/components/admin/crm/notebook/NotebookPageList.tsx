"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { NotebookPageListItem } from "@/lib/crm/contact-notebook";
import NotebookPageThumbnail from "./NotebookPageThumbnail";

type Props = {
  pages: NotebookPageListItem[];
  activePageId: string | null;
  canEdit: boolean;
  contactId: string;
  onSelect: (pageId: string) => void;
  onCreate: () => void;
  onDelete: (pageId: string) => void;
  onMove: (pageId: string, direction: "up" | "down") => void;
};

const NotebookPageList = ({
  pages,
  activePageId,
  canEdit,
  contactId,
  onSelect,
  onCreate,
  onDelete,
  onMove,
}: Props) => (
  <aside className="crm-notebook-sidebar">
    <div className="crm-notebook-sidebar-header">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--crm-muted)]">
        Hojas
      </span>
      {canEdit && (
        <button
          type="button"
          className="crm-btn-icon size-7"
          aria-label="Nueva hoja"
          title="Nueva hoja"
          onClick={onCreate}
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
    <ul className="crm-notebook-page-list">
      {pages.length === 0 ? (
        <li className="px-3 py-4 text-xs text-[var(--crm-muted)]">
          Sin hojas aún.
        </li>
      ) : (
        pages.map((page, index) => {
          const active = page.id === activePageId;
          return (
            <li key={page.id}>
              <div className={`crm-notebook-page-item${active ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="crm-notebook-page-btn"
                  onClick={() => onSelect(page.id)}
                >
                  <NotebookPageThumbnail
                    contactId={contactId}
                    pageId={page.id}
                    kind={page.kind}
                    previewUrl={page.previewUrl}
                    attachmentMime={page.attachmentMime}
                  />
                  <span className="crm-notebook-page-title">{page.title}</span>
                  {page.sessionNumber != null && (
                    <span className="crm-notebook-page-meta">
                      Sesión {page.sessionNumber}
                    </span>
                  )}
                </button>
                {canEdit && (
                  <div className="crm-notebook-page-actions">
                    <button
                      type="button"
                      className="crm-btn-icon size-6"
                      aria-label="Subir"
                      disabled={index === 0}
                      onClick={() => onMove(page.id, "up")}
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="crm-btn-icon size-6"
                      aria-label="Bajar"
                      disabled={index === pages.length - 1}
                      onClick={() => onMove(page.id, "down")}
                    >
                      <ChevronDown className="size-3" />
                    </button>
                    <button
                      type="button"
                      className="crm-btn-icon size-6 text-red-600"
                      aria-label="Eliminar hoja"
                      onClick={() => onDelete(page.id)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })
      )}
    </ul>
  </aside>
);

export default NotebookPageList;
