"use client";

import { WorkshopEditionStatus } from "@prisma/client";
import { Check, Copy, ExternalLink, Megaphone, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
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
          <Button variant="outline" size="sm" onClick={() => void copyWorkshopUrl(e.slug)}>
            {urlCopied ? (
              <>
                <Check aria-hidden="true" />
                Copiada
              </>
            ) : (
              <>
                <Copy aria-hidden="true" />
                Copiar link
              </>
            )}
          </Button>
        )}
        {e.status === WorkshopEditionStatus.OPEN && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ver en web"
            title="Ver en web"
            render={
              <Link href={`/taller-virtual/${e.slug}`} target="_blank" rel="noopener noreferrer" />
            }
          >
            <ExternalLink />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notificar contactos"
          title="Notificar contactos"
          onClick={() => setNotifyEdition(e)}
        >
          <Megaphone />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => openEdit(e)}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          aria-label="Eliminar"
          onClick={() => remove(e.slug)}
        >
          <Trash2 />
        </Button>
      </>
    );
  };

  const EditionMeta = ({ e }: { e: WorkshopRow }) =>
    e.dateLabel ? (
      <p className="mt-2 text-xs text-muted-foreground">
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
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        )}

        <section>
          <Card className="overflow-hidden py-0">
            <CardContent className="divide-y divide-border p-0">
              {loading ? (
                <div className="p-8 text-center">
                  <p className="text-sm font-semibold">Cargando ediciones…</p>
                </div>
              ) : sortedEditions.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm font-semibold">Sin ediciones</p>
                  {!preview && (
                    <Button variant="outline" size="sm" className="mt-3" onClick={openCreate}>
                      Crear edición
                    </Button>
                  )}
                </div>
              ) : (
                sortedEditions.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{e.title}</span>
                        {e.status === WorkshopEditionStatus.OPEN && (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-100 dark:text-emerald-800">
                            Activo en web
                          </Badge>
                        )}
                      </div>
                      {e.editionLabel && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {e.editionLabel}
                        </div>
                      )}
                      <EditionMeta e={e} />
                    </div>
                    <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                      {STATUS_LABEL[e.status]}
                    </Badge>
                    <div className="flex shrink-0 items-center gap-1">
                      <EditionActions e={e} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
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
