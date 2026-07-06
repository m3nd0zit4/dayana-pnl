"use client";

import { Copy, MessageCircle } from "lucide-react";
import { buildContactWhatsAppUrl } from "@/lib/whatsapp-contact";
import { Button } from "@/app/components/ui/button";
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
      <p className="text-xs text-muted-foreground">
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
          <p className="text-[10px] font-semibold text-[#128C7E] uppercase tracking-wide">
            {label}
          </p>
          <p className="mt-1 font-mono text-sm text-foreground">{phoneE164}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-[#25D366] hover:bg-[#25D366]/90"
            render={<a href={chatUrl} target="_blank" rel="noopener noreferrer" />}
          >
            <MessageCircle />
            Abrir chat
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyPhone()}>
            <Copy />
            Copiar número
          </Button>
        </div>
      </div>
      {!compact && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Se abre WhatsApp con este contacto. Usa los mensajes rápidos de abajo para copiar el
          texto y pegarlo tú misma.
        </p>
      )}
    </div>
  );
};

export default WhatsAppContactBlock;
