"use client";

import { Copy, MessageCircle } from "lucide-react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { useCrm } from "./CrmProvider";

type Props = {
  phoneE164: string;
  label?: string;
  compact?: boolean;
};

const WhatsAppContactBlock = ({
  phoneE164,
  label = "WhatsApp",
  compact = false,
}: Props) => {
  const { toast } = useCrm();
  const chatUrl = buildContactWhatsAppUrl(phoneE164);

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(phoneE164);
      toast("Número copiado");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  if (!chatUrl) {
    return (
      <p className="text-xs text-[var(--crm-muted)]">
        Ingresa un teléfono válido con código de país (ej. +57…) para abrir WhatsApp.
      </p>
    );
  }

  return (
    <div
      className={`rounded-xl border border-[#25D366]/25 bg-[#25D366]/[0.06] ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#128C7E]">
            {label}
          </p>
          <p className="mt-1 font-mono text-sm text-[var(--crm-foreground)]">
            {phoneE164}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="crm-btn-primary inline-flex items-center gap-2 bg-[#25D366] hover:opacity-90"
          >
            <MessageCircle className="size-4" />
            Abrir chat
          </a>
          <button
            type="button"
            className="crm-btn-secondary inline-flex items-center gap-1.5 text-xs"
            onClick={() => void copyPhone()}
          >
            <Copy className="size-3.5" />
            Copiar número
          </button>
        </div>
      </div>
      {!compact && (
        <p className="mt-2 text-[11px] text-[var(--crm-muted)]">
          Se abre WhatsApp con este contacto. Usa los mensajes rápidos de abajo para copiar el
          texto y pegarlo tú misma.
        </p>
      )}
    </div>
  );
};

export default WhatsAppContactBlock;
