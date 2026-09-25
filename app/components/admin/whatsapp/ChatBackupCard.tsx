"use client";

import { Download, FileText, ShieldCheck } from "lucide-react";

/**
 * Descargar un respaldo de todos los chats de WhatsApp del CRM (texto legible
 * o JSON completo). Los adjuntos no van, solo su nombre.
 */
const ChatBackupCard = () => (
  <section className="space-y-3 rounded-xl border border-border bg-card p-4">
    <h2 className="flex items-center gap-2 font-semibold">
      <ShieldCheck className="size-5 text-[#00a884]" /> Respaldo de chats
    </h2>
    <p className="text-sm text-muted-foreground">
      Descarga una copia de todos los chats de WhatsApp que tiene el CRM. Guárdala en tu computador o en Drive. Las
      fotos, audios y documentos no van en el archivo, solo su nombre.
    </p>
    <div className="flex flex-wrap gap-2">
      <a
        href="/api/admin/whatsapp/backup?format=txt"
        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#00a884] px-4 text-sm font-medium text-white hover:bg-[#008069] md:h-9"
      >
        <FileText className="size-4" /> Descargar para leer (.txt)
      </a>
      <a
        href="/api/admin/whatsapp/backup?format=json"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium hover:bg-muted md:h-9"
      >
        <Download className="size-4" /> Descargar completo (.json)
      </a>
    </div>
    <p className="text-xs text-muted-foreground">
      Los chats de antes de conectar el CRM no están aquí: tráelos con «Importar chats del celular», justo arriba.
    </p>
  </section>
);

export default ChatBackupCard;
