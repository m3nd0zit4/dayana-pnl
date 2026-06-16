"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useCrm } from "../CrmProvider";

type Props = {
  contactId: string;
  pageId: string;
  mime: string | null;
  name: string | null;
  canEdit: boolean;
  onUploaded: () => void;
};

const NotebookUploadViewer = ({
  contactId,
  pageId,
  mime,
  name,
  canEdit,
  onUploaded,
}: Props) => {
  const { toast } = useCrm();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const attachmentSrc = mime
    ? `/api/admin/contacts/${contactId}/notebook/pages/${pageId}/attachment`
    : null;

  const uploadFile = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      `/api/admin/contacts/${contactId}/notebook/pages/${pageId}/upload`,
      { method: "POST", body: form }
    );
    setUploading(false);
    if (res.ok) {
      toast("Archivo subido");
      onUploaded();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (err.error === "blob_not_configured") {
        toast(
          "Subida no configurada. Conecta Vercel Blob al proyecto o ejecuta bun run env:pull en local.",
          "error"
        );
      } else {
        toast("Error al subir archivo", "error");
      }
    }
  };

  if (!mime) {
    return (
      <div className="crm-notebook-upload-empty">
        {canEdit ? (
          <>
            <p className="text-sm text-[var(--crm-muted)]">
              Sube una imagen o PDF para esta hoja.
            </p>
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
              className="crm-btn-secondary mt-3"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                  Subiendo…
                </>
              ) : (
                "Elegir archivo"
              )}
            </button>
          </>
        ) : (
          <p className="text-sm text-[var(--crm-muted)]">Sin archivo adjunto.</p>
        )}
      </div>
    );
  }

  if (!attachmentSrc) {
    return (
      <p className="p-6 text-sm text-[var(--crm-muted)]">
        No se pudo cargar el adjunto.
      </p>
    );
  }

  if (mime === "application/pdf") {
    return (
      <iframe
        src={attachmentSrc}
        title={name ?? "PDF"}
        className="crm-notebook-upload-frame"
        loading="lazy"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attachmentSrc}
      alt={name ?? "Imagen"}
      className="crm-notebook-upload-image"
      loading="lazy"
    />
  );
};

export default NotebookUploadViewer;
