"use client";

import { useEffect, useState } from "react";
import { UpChunk } from "@mux/upchunk";
import type { LessonContentType, RecordingStatus } from "@prisma/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Trash2 } from "lucide-react";
import { drivePreviewUrl } from "@/lib/lms/drive";
import type { QuizJson } from "@/lib/lms/course-admin";
import {
  DEFAULT_OPERATIONAL_TZ,
  getDateKeyInTz,
  getTimeHmInTz,
  zonedDateTimeToUtc,
} from "@/lib/datetime/zoned-time";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Progress } from "@/app/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
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
  contentType: LessonContentType;
  bodyMd: string | null;
  materialFileName: string | null;
  materialSizeBytes: number | null;
  quizJson: unknown;
  evergreen: boolean;
};

const CONTENT_TYPE_LABEL: Record<LessonContentType, string> = {
  VIDEO: "Video",
  TEXT: "Texto / lectura",
  PDF: "Material PDF",
  QUIZ: "Cuestionario / encuesta",
  EXERCISE: "Ejercicio interactivo",
};

const emptyQuestion = (): QuizJson["questions"][number] => ({
  id: crypto.randomUUID(),
  prompt: "",
  options: [
    { id: crypto.randomUUID(), text: "", correct: true },
    { id: crypto.randomUUID(), text: "", correct: false },
  ],
});

const isQuizJson = (value: unknown): value is QuizJson =>
  Boolean(value) && Array.isArray((value as QuizJson).questions);

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
  contentType: LessonContentType;
  bodyMd: string;
  quiz: QuizJson;
  evergreen: boolean;
};

const emptyEditor: EditorState = {
  id: null,
  title: "",
  description: "",
  scheduledAtLocal: "",
  meetUrl: "",
  recordingUrl: "",
  contentType: "VIDEO",
  bodyMd: "",
  quiz: { questions: [] },
  evergreen: false,
};

const editorFromRow = (
  row: ClassEditorRow,
  timeZone: string
): EditorState => ({
  id: row.id,
  title: row.title,
  description: row.description ?? "",
  scheduledAtLocal: toLocalInput(row.scheduledAt, timeZone),
  meetUrl: row.meetUrl ?? "",
  recordingUrl: row.recordingUrl ?? "",
  contentType: row.contentType,
  bodyMd: row.bodyMd ?? "",
  quiz: isQuizJson(row.quizJson) ? row.quizJson : { questions: [] },
  evergreen: row.evergreen,
});

const toLocalInput = (iso: string | null, timeZone: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${getDateKeyInTz(d, timeZone)}T${getTimeHmInTz(d, timeZone)}`;
};

const localInputToUtcIso = (localValue: string, timeZone: string): string => {
  const [dateKey, timePart] = localValue.split("T");
  if (!dateKey || !timePart) throw new Error("INVALID_ZONED_DATETIME");
  return zonedDateTimeToUtc(dateKey, timePart.slice(0, 5), timeZone).toISOString();
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
  /** IANA zone for datetime-local interpretation (CRM operational TZ). */
  operationalTimezone?: string;
};

const ClassEditorModal = ({
  moduleId,
  open,
  editingRow,
  onClose,
  onSaved,
  onRecordingChange,
  operationalTimezone: operationalTimezoneProp,
}: Props) => {
  const { toast } = useCrm();
  const [crmTz, setCrmTz] = useState(
    operationalTimezoneProp ?? DEFAULT_OPERATIONAL_TZ
  );
  const [editor, setEditor] = useState<EditorState>(() =>
    editingRow
      ? editorFromRow(editingRow, operationalTimezoneProp ?? DEFAULT_OPERATIONAL_TZ)
      : { ...emptyEditor }
  );

  useEffect(() => {
    if (operationalTimezoneProp) {
      setCrmTz(operationalTimezoneProp);
      return;
    }
    let cancelled = false;
    void fetch("/api/admin/site-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { operationalTimezone?: string } | null) => {
        if (!cancelled && data?.operationalTimezone) {
          setCrmTz(data.operationalTimezone);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [operationalTimezoneProp]);

  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [clearingRecording, setClearingRecording] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [clearingMaterial, setClearingMaterial] = useState(false);
  const [showBodyPreview, setShowBodyPreview] = useState(false);

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
    setShowBodyPreview(false);
    setEditor(editingRow ? editorFromRow(editingRow, crmTz) : { ...emptyEditor });
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

  const uploadMaterial = async (file: File) => {
    if (!editor.id) return;
    setUploadingMaterial(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/admin/lms/classes/${editor.id}/material`, {
      method: "POST",
      body: form,
    });
    setUploadingMaterial(false);
    if (!res.ok) {
      toast("No se pudo subir el PDF", "error");
      return;
    }
    toast("PDF subido");
    onRecordingChange();
  };

  const clearMaterial = async () => {
    if (!editor.id) return;
    setClearingMaterial(true);
    const res = await fetch(`/api/admin/lms/classes/${editor.id}/material`, {
      method: "DELETE",
    });
    setClearingMaterial(false);
    if (!res.ok) {
      toast("No se pudo quitar el PDF", "error");
      return;
    }
    toast("PDF eliminado");
    onRecordingChange();
  };

  const addQuestion = () =>
    setEditor((s) => ({ ...s, quiz: { questions: [...s.quiz.questions, emptyQuestion()] } }));
  const removeQuestion = (qId: string) =>
    setEditor((s) => ({
      ...s,
      quiz: { questions: s.quiz.questions.filter((q) => q.id !== qId) },
    }));
  const updateQuestionPrompt = (qId: string, prompt: string) =>
    setEditor((s) => ({
      ...s,
      quiz: {
        questions: s.quiz.questions.map((q) => (q.id === qId ? { ...q, prompt } : q)),
      },
    }));
  const addOption = (qId: string) =>
    setEditor((s) => ({
      ...s,
      quiz: {
        questions: s.quiz.questions.map((q) =>
          q.id === qId
            ? { ...q, options: [...q.options, { id: crypto.randomUUID(), text: "", correct: false }] }
            : q
        ),
      },
    }));
  const removeOption = (qId: string, optId: string) =>
    setEditor((s) => ({
      ...s,
      quiz: {
        questions: s.quiz.questions.map((q) =>
          q.id === qId ? { ...q, options: q.options.filter((o) => o.id !== optId) } : q
        ),
      },
    }));
  const updateOptionText = (qId: string, optId: string, text: string) =>
    setEditor((s) => ({
      ...s,
      quiz: {
        questions: s.quiz.questions.map((q) =>
          q.id === qId
            ? { ...q, options: q.options.map((o) => (o.id === optId ? { ...o, text } : o)) }
            : q
        ),
      },
    }));
  const setCorrectOption = (qId: string, optId: string) =>
    setEditor((s) => ({
      ...s,
      quiz: {
        questions: s.quiz.questions.map((q) =>
          q.id === qId
            ? { ...q, options: q.options.map((o) => ({ ...o, correct: o.id === optId })) }
            : q
        ),
      },
    }));

  const save = async () => {
    const recordingUrl = editor.recordingUrl.trim();
    if (editor.contentType === "VIDEO" && recordingUrl && !drivePreviewUrl(recordingUrl)) {
      toast(
        "El enlace de grabación no parece de Google Drive; los miembros verán solo un botón externo.",
        "info"
      );
    }

    if (editor.contentType === "QUIZ") {
      if (editor.quiz.questions.length === 0) {
        toast("Agrega al menos una pregunta", "error");
        return;
      }
      for (const q of editor.quiz.questions) {
        if (!q.prompt.trim()) {
          toast("Cada pregunta necesita un enunciado", "error");
          return;
        }
        if (q.options.some((o) => !o.text.trim())) {
          toast("Cada opción necesita texto", "error");
          return;
        }
        if (!q.options.some((o) => o.correct)) {
          toast("Marca la respuesta correcta de cada pregunta", "error");
          return;
        }
      }
    }

    const body: Record<string, unknown> = {
      title: editor.title.trim(),
      description: editor.description.trim() || null,
      scheduledAt: null as string | null,
      meetUrl: editor.meetUrl.trim() || null,
      recordingUrl: recordingUrl || null,
      contentType: editor.contentType,
      bodyMd: editor.contentType === "TEXT" ? editor.bodyMd.trim() || null : null,
      quizJson: editor.contentType === "QUIZ" ? editor.quiz : null,
      evergreen: editor.evergreen,
    };
    if (editor.scheduledAtLocal) {
      try {
        body.scheduledAt = localInputToUtcIso(editor.scheduledAtLocal, crmTz);
      } catch {
        toast("Fecha u hora inválida", "error");
        return;
      }
    }
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
          <Label>Tipo de contenido</Label>
          <Select
            value={editor.contentType}
            onValueChange={(value) =>
              setEditor((s) => ({
                ...s,
                contentType: (typeof value === "string" ? value : "VIDEO") as LessonContentType,
              }))
            }
          >
            <SelectTrigger aria-label="Tipo de contenido">
              <SelectValue>
                {(value) => CONTENT_TYPE_LABEL[value as LessonContentType] ?? String(value)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CONTENT_TYPE_LABEL) as LessonContentType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {CONTENT_TYPE_LABEL[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Descripción</Label>
          <Textarea
            className="min-h-20"
            value={editor.description}
            onChange={(e) => setEditor((s) => ({ ...s, description: e.target.value }))}
          />
        </div>

        {editor.contentType === "VIDEO" && (
          <>
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
                <p className="text-[10px] text-muted-foreground">
                  Zona CRM:{" "}
                  <span className="font-mono text-foreground/70">{crmTz}</span>.
                  En el portal cada miembro ve su hora local.
                </p>
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

              <label className="flex items-start gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  checked={editor.evergreen}
                  onChange={(e) =>
                    setEditor((s) => ({ ...s, evergreen: e.target.checked }))
                  }
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  Contenido permanente
                  <span className="block text-xs text-muted-foreground">
                    No caduca. Sin marcar, la grabación desaparece del portal 30
                    días después de publicarse (réplica de clase en vivo).
                  </span>
                </span>
              </label>

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
          </>
        )}

        {editor.contentType === "TEXT" && (
          <div className="space-y-1.5">
            <div className="mb-1 flex items-center justify-between">
              <Label className="mb-0">Contenido (Markdown)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowBodyPreview((v) => !v)}
              >
                {showBodyPreview ? "Editar" : "Vista previa"}
              </Button>
            </div>
            {showBodyPreview ? (
              <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-card p-4 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc">
                <Markdown remarkPlugins={[remarkGfm]}>{editor.bodyMd || "*Sin contenido*"}</Markdown>
              </div>
            ) : (
              <Textarea
                className="min-h-[20vh] font-mono text-[13px]"
                value={editor.bodyMd}
                onChange={(e) => setEditor((s) => ({ ...s, bodyMd: e.target.value }))}
                placeholder="## Título de la lectura&#10;&#10;Contenido en Markdown…"
              />
            )}
          </div>
        )}

        {editor.contentType === "PDF" && (
          <div className="space-y-1.5">
            <Label>Material PDF</Label>
            {!editor.id ? (
              <p className="text-xs text-muted-foreground">
                Guarda la clase primero para subir el PDF.
              </p>
            ) : (
              <div className="space-y-2">
                {editingRow?.materialFileName && (
                  <p className="text-sm">
                    {editingRow.materialFileName}
                    {editingRow.materialSizeBytes != null && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {(editingRow.materialSizeBytes / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    )}
                  </p>
                )}
                <Input
                  type="file"
                  accept="application/pdf"
                  disabled={uploadingMaterial}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void uploadMaterial(file);
                  }}
                />
                {editingRow?.materialFileName && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={clearingMaterial}
                    onClick={() => void clearMaterial()}
                  >
                    {clearingMaterial ? "Quitando…" : "Quitar PDF"}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {editor.contentType === "QUIZ" && (
          <div className="space-y-3">
            <Label>Preguntas</Label>
            {editor.quiz.questions.map((q, qIndex) => (
              <div key={q.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <Input
                    value={q.prompt}
                    onChange={(e) => updateQuestionPrompt(q.id, e.target.value)}
                    placeholder={`Pregunta ${qIndex + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar pregunta"
                    onClick={() => removeQuestion(q.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="space-y-1.5 pl-1">
                  {q.options.map((opt) => (
                    <div key={opt.id} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-${q.id}`}
                        checked={opt.correct}
                        onChange={() => setCorrectOption(q.id, opt.id)}
                        aria-label="Respuesta correcta"
                        className="size-4 accent-primary"
                      />
                      <Input
                        value={opt.text}
                        onChange={(e) => updateOptionText(q.id, opt.id, e.target.value)}
                        placeholder="Opción"
                        className="h-8"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Eliminar opción"
                        disabled={q.options.length <= 2}
                        onClick={() => removeOption(q.id, opt.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => addOption(q.id)}>
                    <Plus /> Agregar opción
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
              <Plus /> Agregar pregunta
            </Button>
          </div>
        )}

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
