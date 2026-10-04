"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCrm } from "../crm/CrmProvider";
import { MODE_SHORT } from "./status";

type Mode = "AUTO" | "COPILOT" | "MANUAL";

const OPTIONS: { mode: Mode; hint: string; confirm: string }[] = [
  { mode: "AUTO", hint: "La IA responde sola", confirm: "La IA responderá sola en todos los chats (menos los favoritos ⭐)." },
  { mode: "COPILOT", hint: "La IA deja borradores y tú los envías", confirm: "En todos los chats la IA dejará borradores y tú los envías." },
  { mode: "MANUAL", hint: "Contestas tú: la IA no escribe", confirm: "La IA dejará de escribir en todos los chats." },
];

/**
 * El modo general de WhatsApp, a un toque desde la lista de chats: un botón
 * pequeño («Modo: IA») que abre las tres opciones y pide confirmación, porque
 * cambia todos los chats a la vez (menos los favoritos ⭐). Cada chat se sigue
 * cambiando aparte desde su menú «⋯».
 */
const GlobalModeSwitch = ({ onChanged }: { onChanged: () => void }) => {
  const { toast, confirm, canWrite } = useCrm();
  const [mode, setMode] = useState<Mode | null>(null);
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
      toast(`Listo: ${data.chats ?? 0} chats en modo ${MODE_SHORT[next]}.`, "success");
      onChanged();
    } catch {
      toast("No se pudo cambiar el modo general.", "error");
    } finally {
      setBusy(false);
    }
  };

  const ask = (next: Mode) => {
    if (next === mode) return;
    const option = OPTIONS.find((o) => o.mode === next)!;
    confirm({
      title: `Todos los chats en modo ${MODE_SHORT[next]}`,
      message: option.confirm,
      confirmLabel: `Pasar todos a ${MODE_SHORT[next]}`,
      onConfirm: () => apply(next),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={!canWrite || busy || !mode}
        title="Modo de todos los chats"
        aria-label={`Modo de todos los chats: ${mode ? MODE_SHORT[mode] : "…"}`}
        className={cn(
          "inline-flex h-10 shrink-0 items-center gap-1 rounded-full border border-(--wa-border) bg-(--wa-surface) px-3 text-xs font-medium text-(--wa-icon) outline-none hover:text-(--wa-text) focus-visible:ring-2 focus-visible:ring-(--wa-green) disabled:opacity-60 md:h-8"
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Modo: <span className="text-(--wa-text)">{mode ? MODE_SHORT[mode] : "…"}</span>
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Modo de todos los chats</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={mode ?? undefined} onValueChange={(v) => ask(v as Mode)}>
            {OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.mode} value={o.mode} className="min-h-11 items-start py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{MODE_SHORT[o.mode]}</span>
                  <span className="text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default GlobalModeSwitch;
