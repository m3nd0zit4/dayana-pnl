"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { Megaphone, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import BroadcastNotifyModal from "./BroadcastNotifyModal";
import { useCrm } from "./CrmProvider";
import WorkshopFormModal, { type WorkshopRow } from "./WorkshopFormModal";
import { isLockedWorkshopSlug, PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";

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

  const proximo = useMemo(
    () => editions.find((e) => e.slug === PROXIMO_WORKSHOP_SLUG) ?? null,
    [editions]
  );
  const otherEditions = useMemo(
    () => editions.filter((e) => e.slug !== PROXIMO_WORKSHOP_SLUG),
    [editions]
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row: WorkshopRow) => {
    if (isLockedWorkshopSlug(row.slug)) return;
    setEditing(row);
    setModalOpen(true);
  };

  const remove = (slug: string) => {
    if (isLockedWorkshopSlug(slug)) return;
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
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast(
            data.error === "locked_edition"
              ? "Esta edición no se puede eliminar"
              : "No se pudo eliminar la edición",
            "error"
          );
        }
      },
    });
  };

  const EditionActions = ({ e }: { e: WorkshopRow }) => {
    if (preview || isLockedWorkshopSlug(e.slug)) return null;
    return (
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
    );
  };

  const EditionMeta = ({ e }: { e: WorkshopRow }) =>
    e.dateLabel ? (
      <p className="mt-2 text-xs text-[var(--crm-muted)]">
        {e.dateLabel}
        {e.scheduleLabel ? ` · ${e.scheduleLabel}` : ""}
      </p>
    ) : null;

  return (
    <CrmPageShell>
      <div className="space-y-5">
        <CrmPageHeader
          title="Talleres"
          action={
            !preview ? (
              <CrmNewButton label="Nueva edición" onClick={openCreate} />
            ) : undefined
          }
        />

        {proximo && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--crm-muted)]">
              Próximo taller
            </h2>
            <div className="crm-surface-card border-dashed p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">
                    {proximo.title || "Próximo taller"}
                  </div>
                  {proximo.editionLabel && (
                    <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                      {proximo.editionLabel}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-[var(--crm-muted)]">
                    Placeholder fijo en la web. Se gestiona desde código, no desde el CRM.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--crm-border)] bg-[var(--crm-linen)]/40 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--crm-accent)]">
                  {STATUS_LABEL[proximo.status]}
                </span>
              </div>
              <EditionMeta e={proximo} />
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--crm-muted)]">
            Ediciones
          </h2>
          <div className="crm-group">
            {otherEditions.length === 0 ? (
              <div className="crm-empty">
                <p className="crm-empty-title">Sin ediciones</p>
                {!preview && (
                  <button type="button" className="crm-btn-secondary crm-btn-compact" onClick={openCreate}>
                    Crear edición
                  </button>
                )}
              </div>
            ) : (
              otherEditions.map((e) => (
                <div key={e.id} className="crm-group-row">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{e.title}</div>
                    {e.editionLabel && (
                      <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                        {e.editionLabel}
                      </div>
                    )}
                    <EditionMeta e={e} />
                  </div>
                  <span className="hidden shrink-0 rounded-full border border-[var(--crm-border)] bg-[var(--crm-linen)]/40 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--crm-accent)] sm:inline">
                    {STATUS_LABEL[e.status]}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <EditionActions e={e} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
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
