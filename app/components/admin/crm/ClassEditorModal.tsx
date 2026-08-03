"use client";

import { useState } from "react";
import { UpChunk } from "@mux/upchunk";
import type { RecordingStatus } from "@prisma/client";
import { drivePreviewUrl } from "@/lib/lms/drive";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Progress } from "@/app/components/ui/progress";
import { Textarea } from "@/app/components/ui/textarea";
import CrmModal from "./CrmModal";
import { useCrm } from "./CrmProvider";

export type ClassEditorRow = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  meetUrl: string | null;
  recordingUrl: string | null;
  muxPlaybackId: string | null;
  recordingStatus: RecordingStatus;
  recordingErrorMessage: string | null;
};

const RECORDING_STATUS_LABEL: Record<RecordingStatus, string> = {
  NONE: "Sin grabación",
  UPLOADING: "Subiendo…",
  PROCESSING: "Procesando…",
  READY: "Lista",
  ERRORED: "Error",
};

const RECORDING_STATUS_VARIANT: Record<
  RecordingStatus,
  "secondary" | "outline" | "default" | "destructive"
> = {
  NONE: "outline",
  UPLOADING: "secondary",
  PROCESSING: "secondary",
  READY: "default",
  ERRORED: "destructive",
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

export type ClassEditorHandle = {
  open: (row?: ClassEditorRow) => void;
};

type Props = {
  /** Classes created here are assigned straight into this module. */
  moduleId: string;
  open: boolean;
  editingRow: ClassEditorRow | null;
  onClose: () => void;
  onSaved: () => void;
  /** Called after an upload starts or a recording is cleared, so the parent can refetch status. */
  onRecordingChange: () => void;
};

const ClassEditorModal = ({
  moduleId,
  open,
  editingRow,
  onClose,
  onSaved,
  onRecordingChange,
}: Props) => {
  const { toast } = useCrm();
  const [editor, setEditor] = useState<EditorState>(() =>
    editingRow
      ? {
          id: editingRow.id,
          title: editingRow.title,
          description: editingRow.description ?? "",
          scheduledAtLocal: toLocalInput(editingRow.scheduledAt),
          meetUrl: editingRow.meetUrl ?? "",
          recordingUrl: editingRow.recordingUrl ?? "",
        }
      : { ...emptyEditor }
  );
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [clearingRecording, setClearingRecording] = useState(false);

  // Only ever show the legacy Drive field for a row that already had one when
  // it was opened — new classes can no longer add a fresh Drive link, only
  // Mux uploads. Recomputed alongside the reset-on-row-change block below.
  const [hasLegacyDrive, setHasLegacyDrive] = useState(
    Boolean(editingRow?.recordingUrl)
  );

  // Reset local state whenever a different row (or a fresh "new class") opens.
  const [openedFor, setOpenedFor] = useState(editingRow?.id ?? null);
  if (open && openedFor !== (editingRow?.id ?? null)) {
    setOpenedFor(editingRow?.id ?? null);
    setHasLegacyDrive(Boolean(editingRow?.recordingUrl));
    setUploadProgress(null);
    setEditor(
      editingRow
        ? {
            id: editingRow.id,
            title: editingRow.title,
            description: editingRow.description ?? "",
            scheduledAtLocal: toLocalInput(editingRow.scheduledAt),
            meetUrl: editingRow.meetUrl ?? "",
            recordingUrl: editingRow.recordingUrl ?? "",
          }
        : { ...emptyEditor }
    );
  }

  const uploadRecording = (file: File) => {
    if (!editor.id) return;
    setUploadProgress(0);

    const upload = UpChunk.createUpload({
      file,
      endpoint: async () => {
        const res = await fetch(`/api/admin/lms/classes/${editor.id}/recording`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("No se pudo iniciar la subida");
        const data = (await res.json()) as { uploadUrl: string };
        return data.uploadUrl;
      },
    });

    onRecordingChange();
    upload.on("progress", (e) => setUploadProgress(e.detail));
    upload.on("success", () => {
      setUploadProgress(null);
      toast("Video subido — procesando en Mux");
      onRecordingChange();
    });
    upload.on("error", (e) => {
      setUploadProgress(null);
      toast(e.detail?.message || "No se pudo subir el video", "error");
    });
  };

  const clearRecording = async () => {
    if (!editor.id) return;
    setClearingRecording(true);
    const res = await fetch(`/api/admin/lms/classes/${editor.id}/recording`, {
      method: "DELETE",
    });
    setClearingRecording(false);
    if (!res.ok) {
      toast("No se pudo quitar la grabación", "error");
      return;
    }
    setHasLegacyDrive(false);
    setEditor((s) => ({ ...s, recordingUrl: "" }));
    toast("Grabación eliminada");
    onRecordingChange();
  };

  const save = async () => {
    const recordingUrl = editor.recordingUrl.trim();
    if (recordingUrl && !drivePreviewUrl(recordingUrl)) {
      toast(
        "El enlace de grabación no parece de Google Drive; los miembros verán solo un botón externo.",
        "info"
      );
    }

    const body: Record<string, unknown> = {
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
    if (!editor.id) body.moduleId = moduleId;

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
    onSaved();
  };

  return (
    <CrmModal
      title={editor.id ? "Editar clase" : "Nueva clase"}
      open={open}
      onClose={onClose}
      large
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Título *</Label>
          <Input
            value={editor.title}
            onChange={(e) => setEditor((s) => ({ ...s, title: e.target.value }))}
            placeholder="Clase 5 · Anclajes"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Descripción</Label>
          <Textarea
            className="min-h-20"
            value={editor.description}
            onChange={(e) => setEditor((s) => ({ ...s, description: e.target.value }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Fecha y hora</Label>
            <Input
              type="datetime-local"
              value={editor.scheduledAtLocal}
              onChange={(e) =>
                setEditor((s) => ({ ...s, scheduledAtLocal: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Enlace Google Meet</Label>
            <Input
              value={editor.meetUrl}
              onChange={(e) => setEditor((s) => ({ ...s, meetUrl: e.target.value }))}
              placeholder="https://meet.google.com/…"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Grabación</Label>
            {editingRow && (
              <Badge variant={RECORDING_STATUS_VARIANT[editingRow.recordingStatus]}>
                {RECORDING_STATUS_LABEL[editingRow.recordingStatus]}
              </Badge>
            )}
          </div>

          {!editor.id ? (
            <p className="text-xs text-muted-foreground">
              Guarda la clase primero para subir el video.
            </p>
          ) : (
            <div className="space-y-2">
              <Input
                type="file"
                accept="video/*"
                disabled={uploadProgress !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) uploadRecording(file);
                }}
              />
              {uploadProgress !== null && (
                <Progress value={uploadProgress} />
              )}
              {editingRow?.recordingErrorMessage && (
                <p className="text-xs text-destructive">
                  {editingRow.recordingErrorMessage}
                </p>
              )}
              {(editingRow?.muxPlaybackId || editingRow?.recordingUrl) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={clearingRecording}
                  onClick={() => void clearRecording()}
                >
                  {clearingRecording ? "Quitando…" : "Quitar grabación"}
                </Button>
              )}
            </div>
          )}

          {hasLegacyDrive && (
            <div className="space-y-1.5 pt-1">
              <Label className="text-muted-foreground">
                Enlace de Google Drive (heredado)
              </Label>
              <Input
                value={editor.recordingUrl}
                onChange={(e) => setEditor((s) => ({ ...s, recordingUrl: e.target.value }))}
                placeholder="https://drive.google.com/file/d/…/view"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </CrmModal>
  );
};

export default ClassEditorModal;
