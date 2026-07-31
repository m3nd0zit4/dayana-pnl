"use client";

import { useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";

export type WorkshopDocumentItem = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type Props = {
  slug: string;
  documents: WorkshopDocumentItem[];
  onChange: (documents: WorkshopDocumentItem[]) => void;
};

const WorkshopDocumentsPanel = ({ slug, documents, onChange }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  const uploadOne = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/admin/workshops/${encodeURIComponent(slug)}/documents`,
      { method: "POST", body: form }
    );
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      const message =
        d.error === "file_too_large"
          ? `${file.name}: el archivo supera 25 MB.`
          : d.error === "invalid_mime"
            ? `${file.name}: formato no permitido.`
            : `${file.name}: no se pudo subir.`;
      throw new Error(message);
    }
    const data = (await res.json()) as { document: WorkshopDocumentItem };
    return data.document;
  };

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setError(null);
    setUploading(true);
    const uploaded: WorkshopDocumentItem[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        uploaded.push(await uploadOne(file));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Error al subir el archivo.");
      }
    }
    setUploading(false);
    if (uploaded.length > 0) onChange([...documents, ...uploaded]);
    if (errors.length > 0) setError(errors.join(" "));
  };

  const onDelete = async (documentId: string) => {
    setDeletingId(documentId);
    const res = await fetch(
      `/api/admin/workshops/${encodeURIComponent(slug)}/documents/${documentId}`,
      { method: "DELETE" }
    );
    setDeletingId(null);
    if (!res.ok) {
      setError("No se pudo eliminar el documento.");
      return;
    }
    onChange(documents.filter((d) => d.id !== documentId));
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Label>Materiales descargables</Label>
      <p className="text-xs text-muted-foreground">
        PDF, imágenes o Word — visibles solo para quienes ya pagaron el
        taller. Máximo 25 MB por archivo.
      </p>

      {documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{doc.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {formatSize(doc.sizeBytes)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={deletingId === doc.id}
                onClick={() => void onDelete(doc.id)}
              >
                {deletingId === doc.id ? "Eliminando…" : "Eliminar"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => void onFilesSelected(e)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={onPick}
      >
        {uploading ? "Subiendo…" : "Subir documento"}
      </Button>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default WorkshopDocumentsPanel;
