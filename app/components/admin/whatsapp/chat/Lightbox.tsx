"use client";

import { Download, X } from "lucide-react";
import { useEffect, useRef } from "react";

/** La foto en grande, encima de todo. Se cierra con la X, con Esc o tocando fuera. */
const Lightbox = ({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      onClick={onClose}
    >
      <div className="flex items-center justify-end gap-2 p-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={src}
          download
          className="grid size-11 place-items-center rounded-full text-white/90 hover:bg-white/10"
          aria-label="Descargar"
          title="Descargar"
        >
          <Download className="size-6" />
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="grid size-11 place-items-center rounded-full text-white/90 hover:bg-white/10"
          aria-label="Cerrar"
          title="Cerrar (Esc)"
        >
          <X className="size-6" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 pt-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {alt && alt !== "Foto" && (
        <p className="px-4 pb-4 text-center text-sm text-white/90" onClick={(e) => e.stopPropagation()}>
          {alt}
        </p>
      )}
    </div>
  );
};

export default Lightbox;
