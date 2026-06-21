"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { Check, Copy, ExternalLink, Megaphone, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import BroadcastNotifyModal from "./BroadcastNotifyModal";
import { useCrm } from "./CrmProvider";
import WorkshopFormModal, {
  mapApiEditionToRow,
  type WorkshopRow,
} from "./WorkshopFormModal";

const STATUS_LABEL: Record<WorkshopEditionStatus, string> = {
  DRAFT: "Borrador",
  OPEN: "Abierto",
  CLOSED: "Cerrado",
  COMPLETED: "Completado",
};

type Props = {
  preview: boolean;
  initialEditions?: WorkshopRow[];
  loadError?: string;
};

const WorkshopsPageClient = ({
  preview,
  initialEditions,
  loadError: initialLoadError,
}: Props) => {
  const { confirm, toast } = useCrm();
  const [editions, setEditions] = useState<WorkshopRow[]>(initialEditions ?? []);
  const [loading, setLoading] = useState(!preview && initialEditions === undefined);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkshopRow | null>(null);
  const [notifyEdition, setNotifyEdition] = useState<WorkshopRow | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const workshopPublicUrl = (slug: string) =>
    `${window.location.origin}/taller-virtual/${slug}`;

  const copyWorkshopUrl = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(workshopPublicUrl(slug));
      setCopiedSlug(slug);
      toast("URL del taller copiada");
      window.setTimeout(() => setCopiedSlug(null), 2000);
    } catch {
      toast("No se pudo copiar la URL", "error");
    }
  };

  const load = useCallback(() => {
    if (preview) {
      setEditions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    fetch("/api/admin/workshops")
      .then((res) => {
        if (!res.ok) throw new Error("fetch_failed");
        return res.json();
      })
      .then((data: { editions?: Parameters<typeof mapApiEditionToRow>[0][] }) => {
        setEditions((data.editions ?? []).map(mapApiEditionToRow));
      })
      .catch(() => {
        setEditions([]);
        setLoadError("No se pudieron cargar las ediciones de taller.");
      })
      .finally(() => setLoading(false));
  }, [preview]);

  useEffect(() => {
    if (preview || initialEditions !== undefined) return;
    load();
  }, [preview, initialEditions, load]);

  const sortedEditions = [...editions].sort((a, b) => {
    if (a.status === WorkshopEditionStatus.OPEN) return -1;
    if (b.status === WorkshopEditionStatus.OPEN) return 1;
    return a.title.localeCompare(b.title, "es");
  });

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
          load();
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
    if (preview) return null;
    const urlCopied = copiedSlug === e.slug;
    return (
      <>
        {e.status === WorkshopEditionStatus.OPEN && (
          <button
            type="button"
            className="crm-btn-secondary crm-btn-compact inline-flex items-center gap-1.5 px-2.5 text-[11px]"
            onClick={() => void copyWorkshopUrl(e.slug)}
          >
            {urlCopied ? (
              <>
                <Check className="size-3.5" aria-hidden="true" />
                Copiada
              </>
            ) : (
              <>
                <Copy className="size-3.5" aria-hidden="true" />
                Copiar link
              </>
            )}
          </button>
        )}
        {e.status === WorkshopEditionStatus.OPEN && (
          <Link
            href={`/taller-virtual/${e.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="crm-btn-icon size-8"
            aria-label="Ver en web"
            title="Ver en web"
          >
            <ExternalLink className="size-4" />
          </Link>
        )}
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

        {loadError && (
          <p className="text-sm text-[var(--crm-danger)]" role="alert">
            {loadError}
          </p>
        )}

        <section>
          <div className="crm-group">
            {loading ? (
              <div className="crm-empty">
                <p className="crm-empty-title">Cargando ediciones…</p>
              </div>
            ) : sortedEditions.length === 0 ? (
              <div className="crm-empty">
                <p className="crm-empty-title">Sin ediciones</p>
                {!preview && (
                  <button
                    type="button"
                    className="crm-btn-secondary crm-btn-compact"
                    onClick={openCreate}
                  >
                    Crear edición
                  </button>
                )}
              </div>
            ) : (
              sortedEditions.map((e) => (
                <div key={e.id} className="crm-group-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{e.title}</span>
                      {e.status === WorkshopEditionStatus.OPEN && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                          Activo en web
                        </span>
                      )}
                    </div>
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
        onSaved={() => {
          load();
          toast("Taller guardado.");
        }}
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
