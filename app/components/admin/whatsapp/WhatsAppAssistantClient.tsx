"use client";

import { Check, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Proposal } from "@/lib/crm/whatsapp-agent/owner-assistant";
import { useCrm } from "../crm/CrmProvider";

type Turn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      proposals: (Proposal & { state?: "applied" | "dismissed" })[];
      tools: string[];
    };

const STORAGE_KEY = "whatsapp-assistant-chat";

const SUGGESTIONS = [
  "¿Cómo te fue hoy con los chats?",
  "Las llamadas de valoración duran 30 minutos",
  "No agendes los viernes",
  "¿Qué le contestarías a alguien que pregunta si atiendo parejas?",
  "Cuando alguien pida precio, primero pregúntale qué está viviendo",
  "Ponme en manual el chat de Laura",
];

const TOOL_LABEL: Record<string, string> = {
  get_status: "revisó el estado",
  get_config: "leyó su configuración",
  list_playbooks: "leyó sus procedimientos",
  find_chat: "buscó el chat",
  simulate_reply: "probó una respuesta",
  propose_config_change: "propuso un cambio",
  propose_playbook: "propuso un procedimiento",
  propose_memory: "propuso una ficha",
  propose_chat_mode: "propuso cambiar un chat",
};

const load = (): Turn[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
};

/**
 * El chat de Dayana con su asistente de WhatsApp: le pregunta cómo va, le
 * enseña reglas nuevas y le pide cambios. Cada cambio llega como propuesta con
 * «Aplicar»; nada se cambia sin su toque.
 */
const WhatsAppAssistantClient = () => {
  const { toast } = useCrm();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTurns(load()), []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-60)));
    } catch {
      // sin almacenamiento: el chat vive solo en esta pestaña
    }
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const ask = async (content: string) => {
    const message = content.trim();
    if (!message || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: message }];
    setTurns(next);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/whatsapp/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((t) => ({
            role: t.role,
            content:
              t.role === "assistant" && t.proposals.length > 0
                ? `${t.content}\n\n[Propuestas: ${t.proposals
                    .map((p) => `${p.summary} (${p.state === "applied" ? "aplicada" : p.state === "dismissed" ? "descartada" : "pendiente"})`)
                    .join("; ")}]`
                : t.content,
          })),
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        proposals?: Proposal[];
        steps?: { tool: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "error");
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          content: data.text || (data.proposals?.length ? "Te dejo la propuesta:" : "Listo."),
          proposals: data.proposals ?? [],
          tools: [...new Set((data.steps ?? []).map((s) => s.tool))],
        },
      ]);
    } catch (e) {
      toast(`El asistente no respondió (${e instanceof Error ? e.message : "error"}).`, "error");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (turnIndex: number, proposalIndex: number, apply: boolean) => {
    const turn = turns[turnIndex];
    if (turn.role !== "assistant") return;
    const proposal = turn.proposals[proposalIndex];
    if (apply) {
      const res = await fetch("/api/admin/whatsapp/assistant/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(`No se pudo aplicar: ${data.error ?? "error"}`, "error");
        return;
      }
      toast("Aplicado. El asistente ya funciona así.", "success");
    }
    setTurns((all) =>
      all.map((t, i) =>
        i === turnIndex && t.role === "assistant"
          ? {
              ...t,
              proposals: t.proposals.map((p, j) =>
                j === proposalIndex ? { ...p, state: apply ? "applied" : "dismissed" } : p
              ),
            }
          : t
      )
    );
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-5 text-[#128c4a]" />
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold">Hablar con la IA de WhatsApp</h1>
          <p className="text-xs text-muted-foreground">
            Pregúntale cómo va, enséñale reglas o pídele cambios. Tú apruebas cada cambio.
          </p>
        </div>
        {turns.length > 0 && (
          <Button size="icon-sm" variant="ghost" aria-label="Borrar conversación" onClick={() => setTurns([])}>
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="space-y-3 pt-6 text-center">
            <p className="text-sm text-muted-foreground">Por ejemplo:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-[#128c4a] px-3 py-2 text-sm whitespace-pre-wrap text-white">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {t.tools.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {t.tools.map((tool) => TOOL_LABEL[tool] ?? tool).join(" · ")}
                </p>
              )}
              <div className="max-w-[90%] rounded-2xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{t.content}</div>
              {t.proposals.map((p, j) => (
                <div
                  key={j}
                  className={cn(
                    "max-w-[90%] space-y-2 rounded-xl border p-3 text-sm",
                    p.state === "applied" ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20" : p.state === "dismissed" ? "opacity-60" : "border-violet-300 bg-violet-50/50 dark:bg-violet-950/20"
                  )}
                >
                  <div className="font-medium">{p.summary}</div>
                  {p.type === "playbook" && (
                    <div className="space-y-1 text-xs">
                      <div><strong>{p.playbook.name}</strong> — cuándo: {p.playbook.trigger}</div>
                      <div className="whitespace-pre-wrap text-muted-foreground">{p.playbook.steps}</div>
                    </div>
                  )}
                  {p.type === "config" && (
                    <div className="text-xs text-muted-foreground">Cambia: {p.changed.join(", ")}</div>
                  )}
                  {p.type === "memory" && (
                    <div className="text-xs whitespace-pre-wrap text-muted-foreground">{p.notes}</div>
                  )}
                  {p.state === "applied" ? (
                    <div className="flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="size-3.5" /> Aplicado</div>
                  ) : p.state === "dismissed" ? (
                    <div className="text-xs text-muted-foreground">Descartado</div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="xs" onClick={() => void decide(i, j, true)} className="bg-[#128c4a] hover:bg-[#0f7a40]">
                        <Check /> Aplicar
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => void decide(i, j, false)}>
                        <X /> Descartar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Pensando…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Escríbele a tu asistente…"
          className="min-h-[2.75rem] flex-1 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(text);
            }
          }}
        />
        <Button onClick={() => void ask(text)} disabled={busy || !text.trim()} className="bg-[#128c4a] hover:bg-[#0f7a40]" aria-label="Enviar">
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  );
};

export default WhatsAppAssistantClient;
