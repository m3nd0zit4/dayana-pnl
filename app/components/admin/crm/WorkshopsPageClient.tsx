"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { CalendarRange, Megaphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import CrmNewButton from "./CrmNewButton";
import CrmPageHeader from "./CrmPageHeader";
import CrmPageShell from "./CrmPageShell";
import BroadcastNotifyModal from "./BroadcastNotifyModal";
import { useCrm } from "./CrmProvider";
import {
  CrmDataList,
  CrmDataListRow,
  CrmEmptyState,
  CrmErrorState,
  CrmLoadingState,
  CrmPublicLink,
  CrmRowAction,
  CrmRowActions,
  CrmRowDelete,
  CrmRowEdit,
} from "./ui";
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
  const { confirm, toast, canManageTeam: canPreview } = useCrm();
  const [editions, setEditions] = useState<WorkshopRow[]>(initialEditions ?? []);
  const [loading, setLoading] = useState(!preview && initialEditions === undefined);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError ?? null);
  const [operationalTimezone, setOperationalTimezone] =
    useState("America/Bogota");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkshopRow | null>(null);
  const [notifyEdition, setNotifyEdition] = useState<WorkshopRow | null>(null);

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
      .then((data: {
        editions?: Parameters<typeof mapApiEditionToRow>[0][];
        operationalTimezone?: string;
      }) => {
        setEditions((data.editions ?? []).map(mapApiEditionToRow));
        if (data.operationalTimezone) {
          setOperationalTimezone(data.operationalTimezone);
        }
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
      confirmLabel: "Eliminar",
      destructive: true,
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

  /**
   * Una edición en borrador o cerrada no tiene página pública que enseñar,
   * salvo para OWNER, que sí puede previsualizarla (`taller-virtual/[slug]`
   * le concede la vista pagada). En vez de esconder el botón según el caso
   * —que es lo que había antes— se muestra siempre y se explica por qué está
   * apagado: así la fila no cambia de forma según el estado.
   */
  const previewBlockedReason = (e: WorkshopRow) =>
    e.status === WorkshopEditionStatus.OPEN || canPreview
      ? undefined
      : `Esta edición está en ${STATUS_LABEL[e.status].toLowerCase()}: aún no tiene página pública.`;

  const EditionActions = ({ e }: { e: WorkshopRow }) => {
    if (preview) return null;
    return (
      <CrmRowActions>
        <CrmPublicLink
          href={`/taller-virtual/${e.slug}`}
          label={
            canPreview
              ? "Ver en web (tú siempre ves la versión pagada)"
              : "Ver en web"
          }
          density="row"
          copy
          disabledReason={previewBlockedReason(e)}
        />
        <CrmRowAction
          icon={Megaphone}
          label="Notificar contactos"
          onClick={() => setNotifyEdition(e)}
        />
        <CrmRowEdit onClick={() => openEdit(e)} />
        <CrmRowDelete onClick={() => remove(e.slug)} />
      </CrmRowActions>
    );
  };

  return (
    <CrmPageShell>
      <CrmPageHeader
        title="Talleres"
        description="Cada edición es una convocatoria con sus propias fechas y su propia página pública."
        secondaryActions={
          <CrmPublicLink href="/taller-virtual" label="Ver listado público" />
        }
        action={
          !preview ? (
            <CrmNewButton label="Nueva edición" onClick={openCreate} />
          ) : undefined
        }
      />

      {loadError ? (
        <CrmErrorState message={loadError} onRetry={load} />
      ) : null}

      <CrmDataList>
        {loading ? (
          <CrmLoadingState rows={3} />
        ) : sortedEditions.length === 0 ? (
          <CrmEmptyState
            icon={CalendarRange}
            title="Sin ediciones"
            description="Crea una edición para abrir una convocatoria de taller y publicar su página."
            action={
              !preview ? (
                <Button variant="outline" size="sm" onClick={openCreate}>
                  Crear edición
                </Button>
              ) : undefined
            }
          />
        ) : (
          sortedEditions.map((e) => (
            <CrmDataListRow key={e.id} actions={<EditionActions e={e} />}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.title}</span>
                  {e.status === WorkshopEditionStatus.OPEN ? (
                    <Badge className="border-success/40 bg-success/10 text-success">
                      Activo en web
                    </Badge>
                  ) : null}
                </div>
                {e.editionLabel ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {e.editionLabel}
                  </div>
                ) : null}
                {e.dateLabel ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.dateLabel}
                    {e.scheduleLabel ? ` · ${e.scheduleLabel}` : ""}
                  </p>
                ) : null}
              </div>
              <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                {STATUS_LABEL[e.status]}
              </Badge>
            </CrmDataListRow>
          ))
        )}
      </CrmDataList>

      <WorkshopFormModal
        open={modalOpen}
        edition={editing}
        operationalTimezone={operationalTimezone}
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
