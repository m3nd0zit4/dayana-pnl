"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, Upload } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../CrmProvider";
import { CrmDataList, CrmDataListRow, CrmEmptyState, CrmRowActions, CrmRowDelete } from "../ui";

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
};

/**
 * La pestaña «Documentos»: los materiales descargables del taller. Solo los
 * ven quienes pagaron, en la página del taller. Se suben y se quitan al
 * momento (no hay que guardar); duplicar un taller no los copia.
 */
const WorkshopDocumentsPanel = ({ slug, documents: initial }: Props) => {
  const { toast, confirm, canWrite } = useCrm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const base = `/api/admin/workshops/${encodeURIComponent(slug)}/documents`;

  const uploadOne = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(base, { method: "POST", body: form });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        d.error === "file_too_large"
          ? `${file.name}: el archivo supera 25 MB.`
          : d.error === "invalid_mime"
            ? `${file.name}: formato no permitido.`
            : d.error === "blob_not_configured"
              ? "El almacenamiento de archivos no está configurado."
              : `${file.name}: no se pudo subir.`
      );
    }
    return ((await res.json()) as { document: WorkshopDocumentItem }).document;
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
    if (uploaded.length > 0) {
      setDocuments((prev) => [...prev, ...uploaded]);
      toast(uploaded.length === 1 ? "Documento subido" : `${uploaded.length} documentos subidos`);
    }
    if (errors.length > 0) setError(errors.join(" "));
  };

  const remove = (doc: WorkshopDocumentItem) =>
    confirm({
      title: "Quitar documento",
      message: `«${doc.filename}» deja de estar disponible para quienes pagaron el taller.`,
      confirmLabel: "Quitar",
      destructive: true,
      onConfirm: async () => {
        setDeletingId(doc.id);
        const res = await fetch(`${base}/${doc.id}`, { method: "DELETE" });
        setDeletingId(null);
        if (!res.ok) return void toast("No se pudo quitar el documento.", "error");
        setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
        toast("Documento quitado");
      },
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          PDF, imágenes o Word, de hasta 25 MB. Solo los ven quienes ya pagaron, en la página del taller.
        </p>
        {canWrite ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => void onFilesSelected(e)}
            />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <Upload aria-hidden />
              {uploading ? "Subiendo…" : "Subir documentos"}
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {documents.length === 0 ? (
        <CrmEmptyState
          icon={Paperclip}
          title="Sin documentos"
          description="Sube la guía, el cuaderno de trabajo o lo que quieras que se lleven quienes pagaron."
        />
      ) : (
        <CrmDataList>
          {documents.map((doc) => (
            <CrmDataListRow
              key={doc.id}
              actions={
                canWrite ? (
                  <CrmRowActions>
                    <CrmRowDelete
                      label={`Quitar ${doc.filename}`}
                      disabled={deletingId === doc.id}
                      onClick={() => remove(doc)}
                    />
                  </CrmRowActions>
                ) : undefined
              }
            >
              <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">{formatSize(doc.sizeBytes)}</p>
              </div>
            </CrmDataListRow>
          ))}
        </CrmDataList>
      )}
    </div>
  );
};

export default WorkshopDocumentsPanel;
