"use client";

import { Download, FileText } from "lucide-react";
import { documentName, documentType } from "@/lib/crm/whatsapp-chat-format";
import { KIND_LABEL, mediaSrc, shownKind, type Attachment } from "./utils";

/** Un adjunto dentro de la burbuja: foto (abre en grande), sticker, audio, video o documento. */
const AttachmentView = ({
  a,
  onOpenImage,
}: {
  a: Attachment;
  onOpenImage?: (image: { src: string; alt: string }) => void;
}) => {
  const src = mediaSrc(a.url);
  if (!src) {
    return (
      <div className="mb-1 rounded-md bg-(--wa-text)/5 px-2 py-1.5 text-xs text-(--wa-icon)">
        {a.kind === "unknown"
          ? "Mensaje que WhatsApp no deja ver aquí (encuesta, ver una vez u otro tipo nuevo): ábrelo en el celular"
          : `${KIND_LABEL[shownKind(a)] ?? "📎 Archivo"} · WhatsApp no dejó descargarlo: ábrelo en el celular`}
      </div>
    );
  }
  switch (shownKind(a)) {
    case "image":
      return (
        <button
          type="button"
          onClick={() => onOpenImage?.({ src, alt: a.caption ?? "Foto" })}
          className="mb-1 block max-w-full cursor-zoom-in overflow-hidden rounded-md"
          aria-label="Ver la foto en grande"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={a.caption ?? "Foto"} className="max-h-80 max-w-full rounded-md" loading="lazy" />
        </button>
      );
    case "sticker":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={src} alt="Sticker" className="size-32 object-contain" loading="lazy" />;
    case "audio":
      return <audio src={src} controls preload="none" className="mb-1 h-10 w-64 max-w-full" />;
    case "video":
      return <video src={src} controls playsInline preload="metadata" className="mb-1 max-h-80 w-full max-w-sm rounded-md" />;
    default: {
      const name = documentName(a);
      return (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="mb-1 flex min-h-12 max-w-full items-center gap-2.5 rounded-md bg-(--wa-text)/5 px-2.5 py-2 text-sm text-(--wa-text) hover:bg-(--wa-text)/10"
          title={`Abrir ${name}`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded bg-(--wa-danger)/15 text-(--wa-danger)">
            <FileText className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name}</span>
            <span className="block text-[11px] uppercase text-(--wa-meta)">{documentType(a.mimeType, name)}</span>
          </span>
          <Download className="size-4 shrink-0 text-(--wa-icon)" />
        </a>
      );
    }
  }
};

export default AttachmentView;
