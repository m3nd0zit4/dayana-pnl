"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCrm } from "./CrmProvider";

export type ContactNoteItem = {
  id: string;
  kind: string;
  title: string | null;
  bodyText: string | null;
  therapySessionId: string | null;
  enrollmentId: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  attachmentName: string | null;
  createdAt: string;
  sessionNumber: number | null;
  productTitle: string | null;
};

type Props = {
  contactId: string;
};

const snippet = (text: string | null, max = 100) => {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
};

const NoteAttachmentPreview = ({
  url,
  mime,
  name,
  expanded,
}: {
  url: string;
  mime: string | null;
  name: string | null;
  expanded: boolean;
}) => {
  if (!expanded) {
    const isPdf = mime === "application/pdf";
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-linen)]/30 px-3 py-2 text-xs text-[var(--crm-muted)]">
        {isPdf ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}
        <span>{name ?? "Adjunto"}</span>
      </div>
    );
  }

  if (mime === "application/pdf") {
    return (
      <iframe
        src={url}
        title={name ?? "PDF"}
        className="mt-2 h-64 w-full rounded-lg border border-[var(--crm-border)]"
        loading="lazy"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name ?? "Nota manuscrita"}
      className="mt-2 max-h-80 w-full rounded-lg border border-[var(--crm-border)] object-contain"
      loading="lazy"
    />
  );
};

const ContactNotesPanel = ({ contactId }: Props) => {
  const { canEditNotes, toast, confirm } = useCrm();
  const [notes, setNotes] = useState<ContactNoteItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [blobUnavailable, setBlobUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNotes = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/admin/contacts/${contactId}/notes?${params}`);
      const data = (await res.json()) as {
        notes?: ContactNoteItem[];
        nextCursor?: string | null;
      };
      return data;
    },
    [contactId]
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const data = await fetchNotes();
      setNotes(data.notes ?? []);
      setNextCursor(data.nextCursor ?? null);
      setLoading(false);
    })();
  }, [fetchNotes]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const data = await fetchNotes(nextCursor);
    setNotes((prev) => [...prev, ...(data.notes ?? [])]);
    setNextCursor(data.nextCursor ?? null);
    setLoadingMore(false);
  };

  const createTextNote = async () => {
    if (!bodyText.trim() && !title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/admin/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title || null, bodyText }),
    });
    setSaving(false);
    if (res.ok) {
      const data = (await res.json()) as { note: ContactNoteItem };
      setNotes((prev) => [data.note, ...prev]);
      setTitle("");
      setBodyText("");
      toast("Nota guardada");
    } else {
      toast("Error al guardar nota", "error");
    }
  };

  const uploadErrorMessage = (code?: string) => {
    if (code === "blob_not_configured") {
      return "Subida de archivos no configurada. Añade BLOB_READ_WRITE_TOKEN en .env (ver .env.example).";
    }
    if (code === "file_too_large") return "El archivo supera el límite de 15 MB.";
    if (code === "invalid_mime") return "Formato no permitido. Usa PDF, JPEG, PNG o WebP.";
    if (code === "blob_upload_failed") return "No se pudo guardar el archivo. Revisa el token de Vercel Blob.";
    return "Error al subir archivo";
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const up = await fetch(`/api/admin/contacts/${contactId}/notes/upload`, {
      method: "POST",
      body: form,
    });
    if (!up.ok) {
      const err = (await up.json().catch(() => ({}))) as { error?: string };
      if (err.error === "blob_not_configured") setBlobUnavailable(true);
      setUploading(false);
      toast(uploadErrorMessage(err.error), "error");
      return;
    }
    const meta = (await up.json()) as {
      attachmentUrl: string;
      attachmentMime: string;
      attachmentName: string;
    };
    const res = await fetch(`/api/admin/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "HANDWRITTEN",
        title: title || file.name,
        bodyText: bodyText || null,
        ...meta,
      }),
    });
    setUploading(false);
    if (res.ok) {
      const data = (await res.json()) as { note: ContactNoteItem };
      setNotes((prev) => [data.note, ...prev]);
      setTitle("");
      setBodyText("");
      toast("Nota manuscrita subida");
    } else {
      toast("Error al crear nota", "error");
    }
  };

  const deleteNote = (noteId: string) => {
    confirm({
      title: "Eliminar nota",
      message: "¿Eliminar esta nota clínica? Esta acción no se puede deshacer.",
      onConfirm: async () => {
        const res = await fetch(`/api/admin/contacts/${contactId}/notes/${noteId}`, {
          method: "DELETE",
        });
        if (res.ok) {
          setNotes((prev) => prev.filter((n) => n.id !== noteId));
          toast("Nota eliminada");
        } else {
          toast("Error al eliminar", "error");
        }
      },
    });
  };

  const patchNote = (noteId: string, patch: { title?: string; bodyText?: string }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/admin/contacts/${contactId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = (await res.json()) as { note: ContactNoteItem };
        setNotes((prev) => prev.map((n) => (n.id === noteId ? data.note : n)));
      }
    }, 500);
  };

  return (
    <div className="space-y-6">
      {canEditNotes && (
        <section className="crm-surface-card space-y-4 p-5">
          <h2 className="crm-section-title text-sm">Nueva nota clínica</h2>
          <div>
            <label className="crm-label" htmlFor="note-title">
              Título (opcional)
            </label>
            <input
              id="note-title"
              className="crm-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Sesión 3 — seguimiento"
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="note-body">
              Notas
            </label>
            <textarea
              id="note-body"
              className="crm-textarea min-h-[240px]"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Escribe las notas clínicas aquí…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="crm-btn-primary"
              disabled={saving || (!bodyText.trim() && !title.trim())}
              onClick={() => void createTextNote()}
            >
              {saving ? "Guardando…" : "Guardar nota"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="crm-btn-secondary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                  Subiendo…
                </>
              ) : (
                "Subir PDF o imagen"
              )}
            </button>
            <span className="text-[10px] text-[var(--crm-muted)]">Máx. 15 MB</span>
          </div>
          {blobUnavailable && (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
              Las subidas de PDF/imagen requieren{" "}
              <code className="text-[11px]">BLOB_READ_WRITE_TOKEN</code> en tu{" "}
              <code className="text-[11px]">.env</code>. Consulta{" "}
              <code className="text-[11px]">.env.example</code> para los pasos. Las
              notas de texto siguen funcionando.
            </p>
          )}
        </section>
      )}

      <section className="crm-surface-card p-5">
        <h2 className="crm-section-title mb-4 text-sm">Historial de notas</h2>
        {loading ? (
          <p className="text-sm text-[var(--crm-muted)]">Cargando notas…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-[var(--crm-muted)]">Sin notas clínicas aún.</p>
        ) : (
          <ul className="divide-y divide-[var(--crm-border)]">
            {notes.map((note) => {
              const expanded = expandedId === note.id;
              return (
                <li key={note.id} className="py-4 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setExpandedId(expanded ? null : note.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {note.title ?? (note.kind === "HANDWRITTEN" ? "Nota manuscrita" : "Nota")}
                        </span>
                        <span className="rounded-full bg-[var(--crm-linen)] px-2 py-0.5 text-[10px] uppercase text-[var(--crm-muted)]">
                          {note.kind === "HANDWRITTEN" ? "Manuscrita" : "Texto"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--crm-muted)]">
                        {new Date(note.createdAt).toLocaleString("es-CO")}
                        {note.sessionNumber != null && (
                          <> · Sesión {note.sessionNumber}</>
                        )}
                        {note.productTitle && <> · {note.productTitle}</>}
                      </p>
                      {!expanded && (
                        <p className="mt-1 text-sm text-[var(--crm-foreground)]">
                          {snippet(note.bodyText) ||
                            (note.attachmentUrl ? "Adjunto — clic para ver" : "")}
                        </p>
                      )}
                    </button>
                    {canEditNotes && (
                      <button
                        type="button"
                        className="crm-btn-icon size-8 shrink-0 text-red-600"
                        aria-label="Eliminar nota"
                        onClick={() => deleteNote(note.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div className="mt-3">
                      {note.bodyText && canEditNotes && note.kind === "TEXT" ? (
                        <textarea
                          className="crm-textarea min-h-[120px] text-sm"
                          defaultValue={note.bodyText}
                          onBlur={(e) =>
                            patchNote(note.id, { bodyText: e.target.value })
                          }
                        />
                      ) : note.bodyText ? (
                        <p className="whitespace-pre-wrap text-sm">{note.bodyText}</p>
                      ) : null}
                      {note.attachmentUrl && (
                        <NoteAttachmentPreview
                          url={note.attachmentUrl}
                          mime={note.attachmentMime}
                          name={note.attachmentName}
                          expanded={expanded}
                        />
                      )}
                      {note.enrollmentId && (
                        <Link
                          href={`/admin/enrollments/${note.enrollmentId}`}
                          className="mt-2 inline-block text-xs text-[var(--crm-accent)] hover:underline"
                        >
                          Ver servicio →
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {nextCursor && (
          <button
            type="button"
            className="crm-btn-ghost mt-4 text-xs"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Cargando…" : "Cargar más notas"}
          </button>
        )}
      </section>
    </div>
  );
};

export default ContactNotesPanel;
