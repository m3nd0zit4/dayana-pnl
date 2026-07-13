"use client";

import { useState } from "react";
import { drivePreviewUrl } from "@/lib/lms/drive";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
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
};

const ClassEditorModal = ({ moduleId, open, editingRow, onClose, onSaved }: Props) => {
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

  // Reset local state whenever a different row (or a fresh "new class") opens.
  const [openedFor, setOpenedFor] = useState(editingRow?.id ?? null);
  if (open && openedFor !== (editingRow?.id ?? null)) {
    setOpenedFor(editingRow?.id ?? null);
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
          <Label>Grabación (enlace de Google Drive)</Label>
          <Input
            value={editor.recordingUrl}
            onChange={(e) => setEditor((s) => ({ ...s, recordingUrl: e.target.value }))}
            placeholder="https://drive.google.com/file/d/…/view"
          />
          <p className="text-xs text-muted-foreground">
            En Drive, comparte el archivo como «Cualquier persona con el enlace —
            Lector». Al pegarlo aquí empieza a contar el mes de disponibilidad.
          </p>
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
