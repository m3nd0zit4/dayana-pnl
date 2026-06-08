"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CrmPageShell from "./CrmPageShell";
import BroadcastNotifyModal from "./BroadcastNotifyModal";
import { useCrm } from "./CrmProvider";
import WorkshopFormModal, { type WorkshopRow } from "./WorkshopFormModal";

const STATUS_LABEL: Record<WorkshopEditionStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Abierto",
  CLOSED: "Cerrado",
  COMPLETED: "Completado",
};

type Props = {
  editions: WorkshopRow[];
  preview: boolean;
};

const WorkshopsPageClient = ({ editions, preview }: Props) => {
  const router = useRouter();
  const { confirm, toast } = useCrm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkshopRow | null>(null);
  const [notifyEdition, setNotifyEdition] = useState<WorkshopRow | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row: WorkshopRow) => {
    setEditing(row);
    setModalOpen(true);
  };

  const remove = (slug: string) => {
    confirm({
      title: "Eliminar edición",
      message:
        "¿Eliminar esta edición de taller? Esta acción no se puede deshacer.",
      onConfirm: async () => {
        const res = await fetch(`/api/admin/workshops/${encodeURIComponent(slug)}`, {
          method: "DELETE",
        });
        if (res.ok) {
          toast("Edición de taller eliminada");
          router.refresh();
        } else {
          toast("No se pudo eliminar la edición", "error");
        }
      },
    });
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="crm-section-title text-xl">Talleres</h1>
            <p className="crm-section-subtitle mt-1 max-w-xl">
              Crear y editar ediciones que se publican en{" "}
              <code className="text-[var(--crm-accent)]">/taller-virtual</code>.
            </p>
          </div>
          {!preview && (
            <button type="button" className="crm-btn-primary" onClick={openCreate}>
              <Plus className="size-4" />
              Nueva edición
            </button>
          )}
        </div>

        <ul className="space-y-3">
          {editions.length === 0 && (
            <li className="crm-surface-card p-6 text-sm text-[var(--crm-muted)]">
              No hay ediciones. Crea la primera con el botón de arriba.
            </li>
          )}
          {editions.map((e) => (
            <li key={e.id} className="crm-surface-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">{e.title}</div>
                  {e.editionLabel && (
                    <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                      {e.editionLabel}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full border border-[var(--crm-border)] bg-[var(--crm-linen)]/40 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--crm-accent)]">
                    {STATUS_LABEL[e.status]}
                  </span>
                  {!preview && (
                    <>
                      <button
                        type="button"
                        className="crm-btn-icon size-8"
                        aria-label="Notificar contactos"
                        title="Notificar contactos"
                        onClick={() => setNotifyEdition(e)}
                      >
                        <Megaphone className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="crm-btn-icon size-8"
                        aria-label="Editar"
                        onClick={() => openEdit(e)}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="crm-btn-icon size-8 text-[var(--crm-danger)]"
                        aria-label="Eliminar"
                        onClick={() => remove(e.slug)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {e.dateLabel && (
                <p className="mt-3 text-xs text-[var(--crm-muted)]">
                  {e.dateLabel}
                  {e.scheduleLabel ? ` · ${e.scheduleLabel}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <WorkshopFormModal
        open={modalOpen}
        edition={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => router.refresh()}
      />

      <BroadcastNotifyModal
        open={!!notifyEdition}
        workshopEditionId={notifyEdition?.id}
        workshopTitle={notifyEdition?.title}
        onClose={() => setNotifyEdition(null)}
      />
    </CrmPageShell>
  );
};

export default WorkshopsPageClient;
