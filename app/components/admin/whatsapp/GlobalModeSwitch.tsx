"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCrm } from "../crm/CrmProvider";

type Mode = "AUTO" | "COPILOT" | "MANUAL";

const OPTIONS: { mode: Mode; label: string; hint: string; confirm: string }[] = [
  { mode: "AUTO", label: "IA", hint: "La IA responde sola en todos los chats", confirm: "La IA responderá sola en todos los chats (menos los favoritos ⭐)." },
  { mode: "COPILOT", label: "Copiloto", hint: "La IA deja borradores y tú los envías", confirm: "En todos los chats la IA dejará borradores y ustedes los envían." },
  { mode: "MANUAL", label: "Manual", hint: "La IA no escribe en ningún chat", confirm: "La IA dejará de escribir en todos los chats." },
];

/**
 * El modo general de WhatsApp, a la vista en la lista de chats: un toque y
 * todos los chats pasan a IA, copiloto o manual (los favoritos ⭐ no se tocan).
 * Cada chat se puede seguir cambiando aparte desde su cabecera.
 */
const GlobalModeSwitch = ({ onChanged }: { onChanged: () => void }) => {
  const { toast, canWrite } = useCrm();
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, setPending] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/whatsapp/mode", { cache: "no-store" }).catch(() => null);
      if (res?.ok) setMode(((await res.json()) as { mode: Mode }).mode);
    })();
  }, []);

  const apply = async (next: Mode) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { chats?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "error");
      setMode(next);
      toast(`Listo: ${data.chats ?? 0} chats en modo ${OPTIONS.find((o) => o.mode === next)?.label}.`, "success");
      onChanged();
    } catch {
      toast("No se pudo cambiar el modo general.", "error");
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const pendingOption = OPTIONS.find((o) => o.mode === pending);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[#54656f]">Todos los chats:</span>
        <div className="inline-flex rounded-full border border-[#d1d7db] bg-white p-0.5 dark:border-border dark:bg-card" role="radiogroup" aria-label="Modo general">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={mode === o.mode}
              title={o.hint}
              disabled={!canWrite || busy}
              onClick={() => (o.mode === mode ? undefined : setPending(o.mode))}
              className={cn(
                "h-7 rounded-full px-3 text-xs font-medium transition-colors",
                mode === o.mode ? "bg-[#00a884] text-white" : "text-[#54656f] hover:text-[#111b21] dark:text-muted-foreground"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        {busy && <Loader2 className="size-4 animate-spin text-[#00a884]" />}
      </div>
      {pendingOption && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#f0f2f5] px-2.5 py-2 text-xs text-[#111b21] dark:bg-muted/40 dark:text-foreground">
          <span className="min-w-0 flex-1">{pendingOption.confirm}</span>
          <button type="button" onClick={() => void apply(pendingOption.mode)} className="rounded-full bg-[#00a884] px-3 py-1 font-medium text-white hover:bg-[#008069]">
            Aplicar a todos
          </button>
          <button type="button" onClick={() => setPending(null)} className="rounded-full px-2 py-1 text-[#54656f] hover:text-[#111b21]">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
};

export default GlobalModeSwitch;
