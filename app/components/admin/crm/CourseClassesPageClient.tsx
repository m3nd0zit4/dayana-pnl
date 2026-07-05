"use client";

import { Plus, Video } from "lucide-react";
import { useCallback, useState } from "react";
import { drivePreviewUrl } from "@/lib/lms/drive";
import { RECORDING_RETENTION_DAYS } from "@/lib/lms/course-content";
import CrmPageShell from "./CrmPageShell";
import CrmModal from "./CrmModal";
import CursoTabs from "./CursoTabs";
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
            <h1 className="crm-section-title text-xl">Curso · Clases</h1>
            <p className="crm-section-subtitle mt-1">
              Programa las clases en vivo (Google Meet) y pega el enlace de la
              grabación de Drive al terminar. La grabación se oculta sola a los{" "}
              {RECORDING_RETENTION_DAYS} días.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CursoTabs />
            {!preview && canWrite && (
              <button
                type="button"
                className="crm-btn-primary crm-btn-compact"
                onClick={() => openEditor()}
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Nueva clase</span>
              </button>
            )}
          </div>
        </div>

        <div className="crm-surface-card overflow-hidden">
          <ul className="divide-y divide-[var(--crm-border)]">
            {rows.length === 0 && (
              <li className="p-8 text-center text-sm text-[var(--crm-muted)]">
                Sin clases. Crea la primera con «Nueva clase».
              </li>
            )}
            {rows.map((row) => (
              <li key={row.id} className="crm-table-row p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{row.title}</div>
                    <div className="mt-0.5 text-xs text-[var(--crm-muted)]">
                      {formatDateTime(row.scheduledAt)}
                      {row.meetUrl ? " · Meet configurado" : " · Sin enlace Meet"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      <Video className="size-3.5 text-[var(--crm-muted)]" aria-hidden />
                      {row.recordingUrl ? (
                        row.recordingHiddenAt ? (
                          <span className="text-[var(--crm-muted)]">
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
                        <span className="text-[var(--crm-muted)]">Sin grabación</span>
                      )}
                    </div>
                  </div>

                  {!preview && canWrite && (
                    <div className="flex flex-wrap items-center gap-2">
                      {row.recordingUrl && !row.recordingHiddenAt && (
                        <button
                          type="button"
                          className="crm-btn-secondary text-xs"
                          disabled={notifyingId === row.id}
                          onClick={() => notifyRecording(row)}
                        >
                          {notifyingId === row.id
                            ? "Notificando…"
                            : "Notificar grabación"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="crm-btn-secondary text-xs"
                        onClick={() => openEditor(row)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="crm-btn-ghost text-xs"
                        onClick={() => remove(row)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <CrmModal
        title={editor?.id ? "Editar clase" : "Nueva clase"}
        open={!!editor}
        onClose={() => setEditor(null)}
        large
      >
        {editor && (
          <div className="space-y-4">
            <label className="block">
              <span className="crm-label">Título *</span>
              <input
                className="crm-input"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="Clase 5 · Anclajes"
              />
            </label>

            <label className="block">
              <span className="crm-label">Descripción</span>
              <textarea
                className="crm-input min-h-20"
                value={editor.description}
                onChange={(e) =>
                  setEditor({ ...editor, description: e.target.value })
                }
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="crm-label">Fecha y hora</span>
                <input
                  type="datetime-local"
                  className="crm-input"
                  value={editor.scheduledAtLocal}
                  onChange={(e) =>
                    setEditor({ ...editor, scheduledAtLocal: e.target.value })
                  }
                />
              </label>
              <label className="block">
                <span className="crm-label">Enlace Google Meet</span>
                <input
                  className="crm-input"
                  value={editor.meetUrl}
                  onChange={(e) =>
                    setEditor({ ...editor, meetUrl: e.target.value })
                  }
                  placeholder="https://meet.google.com/…"
                />
              </label>
            </div>

            <label className="block">
              <span className="crm-label">Grabación (enlace de Google Drive)</span>
              <input
                className="crm-input"
                value={editor.recordingUrl}
                onChange={(e) =>
                  setEditor({ ...editor, recordingUrl: e.target.value })
                }
                placeholder="https://drive.google.com/file/d/…/view"
              />
              <span className="mt-1 block text-xs text-[var(--crm-muted)]">
                En Drive, comparte el archivo como «Cualquier persona con el
                enlace — Lector». Al pegarlo aquí empieza a contar el mes de
                disponibilidad.
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="crm-btn-secondary"
                onClick={() => setEditor(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="crm-btn-primary"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        )}
      </CrmModal>
    </CrmPageShell>
  );
};

export default CourseClassesPageClient;
