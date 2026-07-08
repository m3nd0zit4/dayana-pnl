"use client";

import { Plus, Video } from "lucide-react";
import { useCallback, useState } from "react";
import { drivePreviewUrl } from "@/lib/lms/drive";
import { RECORDING_RETENTION_DAYS } from "@/lib/lms/course-content";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import CrmPageShell from "./CrmPageShell";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

export type LiveClassRow = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  meetUrl: string | null;
  recordingUrl: string | null;
  recordingPostedAt: string | null;
  recordingHiddenAt: string | null;
};

type Props = {
  preview: boolean;
  initialClasses: LiveClassRow[];
};

type EditorState = {
  id: string | null;
  title: string;
  description: string;
  scheduledAtLocal: string;
  meetUrl: string;
  recordingUrl: string;
};

const emptyEditor: EditorState = {
  id: null,
  title: "",
  description: "",
  scheduledAtLocal: "",
  meetUrl: "",
  recordingUrl: "",
};

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Sin fecha";

const recordingExpiry = (postedAt: string) => {
  const until = new Date(
    new Date(postedAt).getTime() + RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  return until.toLocaleDateString("es-CO", { dateStyle: "medium" });
};

const CourseClassesPageClient = ({ preview, initialClasses }: Props) => {
  const { canWrite, toast, confirm } = useCrm();
  const [rows, setRows] = useState<LiveClassRow[]>(initialClasses);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (preview) return;
    const res = await fetch("/api/admin/lms/classes");
    if (!res.ok) return;
    const data = (await res.json()) as { classes?: LiveClassRow[] };
    if (data.classes) setRows(data.classes);
  }, [preview]);

  const openEditor = (row?: LiveClassRow) => {
    setEditor(
      row
        ? {
            id: row.id,
            title: row.title,
            description: row.description ?? "",
            scheduledAtLocal: toLocalInput(row.scheduledAt),
            meetUrl: row.meetUrl ?? "",
            recordingUrl: row.recordingUrl ?? "",
          }
        : { ...emptyEditor }
    );
  };

  const save = async () => {
    if (!editor) return;
    const recordingUrl = editor.recordingUrl.trim();
    if (recordingUrl && !drivePreviewUrl(recordingUrl)) {
      toast(
        "El enlace de grabación no parece de Google Drive; los miembros verán solo un botón externo.",
        "info"
      );
    }

    const body = {
      title: editor.title.trim(),
      description: editor.description.trim() || null,
      scheduledAt: editor.scheduledAtLocal
        ? new Date(editor.scheduledAtLocal).toISOString()
        : null,
      meetUrl: editor.meetUrl.trim() || null,
      recordingUrl: recordingUrl || null,
    };
    if (!body.title) {
      toast("Falta el título", "error");
      return;
    }

    setSaving(true);
    const res = await fetch(
      editor.id ? `/api/admin/lms/classes/${editor.id}` : "/api/admin/lms/classes",
      {
        method: editor.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setSaving(false);

    if (!res.ok) {
      toast("No se pudo guardar la clase", "error");
      return;
    }
    toast(editor.id ? "Clase actualizada" : "Clase creada");
    setEditor(null);
    void reload();
  };

  const notifyRecording = (row: LiveClassRow) => {
    confirm({
      title: "Notificar grabación",
      message: `Se avisará por correo y WhatsApp a los miembros al día que la grabación de «${row.title}» está disponible.`,
      onConfirm: async () => {
        setNotifyingId(row.id);
        const res = await fetch(`/api/admin/lms/classes/${row.id}/notify`, {
          method: "POST",
        });
        setNotifyingId(null);
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          toast(
            data?.error === "forbidden"
              ? "Solo la propietaria puede enviar avisos masivos"
              : "No se pudo notificar",
            "error"
          );
          return;
        }
        const data = (await res.json()) as { targets: number; sent: number };
        toast(`Aviso enviado (${data.sent} envíos a ${data.targets} miembros)`);
      },
    });
  };

  const remove = (row: LiveClassRow) => {
    confirm({
      title: "Eliminar clase",
      message: `¿Eliminar «${row.title}»? Los miembros dejarán de ver su grabación.`,
      onConfirm: async () => {
        const res = await fetch(`/api/admin/lms/classes/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          toast("No se pudo eliminar", "error");
          return;
        }
        toast("Clase eliminada");
        void reload();
      },
    });
  };

  return (
    <CrmPageShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Curso · Clases</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Programa las clases en vivo (Google Meet) y pega el enlace de la
              grabación de Drive al terminar. La grabación se oculta sola a los{" "}
              {RECORDING_RETENTION_DAYS} días.
            </p>
          </div>
          {!preview && canWrite && (
            <Button size="sm" onClick={() => openEditor()}>
              <Plus />
              <span className="hidden sm:inline">Nueva clase</span>
            </Button>
          )}
        </div>

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y divide-border p-0">
            {rows.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Sin clases. Crea la primera con «Nueva clase».
              </div>
            )}
            {rows.map((row) => (
              <div key={row.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{row.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(row.scheduledAt)}
                      {row.meetUrl ? " · Meet configurado" : " · Sin enlace Meet"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      <Video className="size-3.5 text-muted-foreground" aria-hidden />
                      {row.recordingUrl ? (
                        row.recordingHiddenAt ? (
                          <span className="text-muted-foreground">
                            Grabación oculta (venció el mes)
                          </span>
                        ) : row.recordingPostedAt ? (
                          <span className="text-emerald-700">
                            Grabación visible hasta el{" "}
                            {recordingExpiry(row.recordingPostedAt)}
                          </span>
                        ) : (
                          <span className="text-emerald-700">Grabación publicada</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">Sin grabación</span>
                      )}
                    </div>
                  </div>

                  {!preview && canWrite && (
                    <div className="flex flex-wrap items-center gap-2">
                      {row.recordingUrl && !row.recordingHiddenAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={notifyingId === row.id}
                          onClick={() => notifyRecording(row)}
                        >
                          {notifyingId === row.id
                            ? "Notificando…"
                            : "Notificar grabación"}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => openEditor(row)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(row)}>
                        Eliminar
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <CrmModal
        title={editor?.id ? "Editar clase" : "Nueva clase"}
        open={!!editor}
        onClose={() => setEditor(null)}
        large
      >
        {editor && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="Clase 5 · Anclajes"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea
                className="min-h-20"
                value={editor.description}
                onChange={(e) =>
                  setEditor({ ...editor, description: e.target.value })
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Fecha y hora</Label>
                <Input
                  type="datetime-local"
                  value={editor.scheduledAtLocal}
                  onChange={(e) =>
                    setEditor({ ...editor, scheduledAtLocal: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Enlace Google Meet</Label>
                <Input
                  value={editor.meetUrl}
                  onChange={(e) =>
                    setEditor({ ...editor, meetUrl: e.target.value })
                  }
                  placeholder="https://meet.google.com/…"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Grabación (enlace de Google Drive)</Label>
              <Input
                value={editor.recordingUrl}
                onChange={(e) =>
                  setEditor({ ...editor, recordingUrl: e.target.value })
                }
                placeholder="https://drive.google.com/file/d/…/view"
              />
              <p className="text-xs text-muted-foreground">
                En Drive, comparte el archivo como «Cualquier persona con el
                enlace — Lector». Al pegarlo aquí empieza a contar el mes de
                disponibilidad.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditor(null)}>
                Cancelar
              </Button>
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        )}
      </CrmModal>
    </CrmPageShell>
  );
};

export default CourseClassesPageClient;
