"use client";

import { Check, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Switch } from "@/app/components/ui/switch";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCrm } from "../crm/CrmProvider";

type Playbook = {
  id: string;
  name: string;
  trigger: string;
  steps: string;
  isEnabled: boolean;
  source: string;
  version: number;
};

type Draft = { id?: string; name: string; trigger: string; steps: string };

/**
 * Procedimientos del asistente: qué hacer en cada situación. Los que propone
 * la IA a partir de tus correcciones aparecen marcados y apagados hasta que
 * los apruebes.
 */
const WhatsAppPlaybooksCard = () => {
  const { toast } = useCrm();
  const [items, setItems] = useState<Playbook[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/playbooks", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setItems(((await res.json()) as { items: Playbook[] }).items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error();
      await load();
      return true;
    } catch {
      toast("No se pudo guardar.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    const { id, ...body } = editing;
    const ok = id
      ? await call(`/api/admin/whatsapp/playbooks/${id}`, "PATCH", body)
      : await call("/api/admin/whatsapp/playbooks", "POST", body);
    if (ok) setEditing(null);
  };

  const proposals = (items ?? []).filter((p) => p.source === "learned" && !p.isEnabled);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Procedimientos</h2>
          <p className="text-xs text-muted-foreground">
            Qué hace la IA en cada situación. Cuando corriges a la IA, propone uno nuevo aquí para que lo apruebes.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing({ name: "", trigger: "", steps: "" })}>
          <Plus /> Nuevo
        </Button>
      </div>

      {items === null && <Loader2 className="size-4 animate-spin" />}

      {proposals.length > 0 && (
        <p className="flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-900 dark:bg-violet-950/30 dark:text-violet-100">
          <Sparkles className="size-3.5" /> La IA aprendió {proposals.length} cosa(s) de tus correcciones. Revísalas y apruébalas.
        </p>
      )}

      {editing && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Input placeholder="Nombre (p. ej. Precios)" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <Input placeholder="Cuándo aplica (p. ej. Preguntan cuánto vale una sesión)" value={editing.trigger} onChange={(e) => setEditing({ ...editing, trigger: e.target.value })} />
          <Textarea placeholder="Pasos: qué hacer y qué no" rows={5} value={editing.steps} onChange={(e) => setEditing({ ...editing, steps: e.target.value })} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy || editing.name.trim().length < 2 || editing.trigger.trim().length < 3 || editing.steps.trim().length < 3}>
              {busy && <Loader2 className="animate-spin" />} Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {(items ?? []).map((p) => {
          const proposal = p.source === "learned" && !p.isEnabled;
          return (
            <li key={p.id} className={cn("space-y-1 rounded-lg border p-3", proposal ? "border-violet-300 bg-violet-50/40 dark:bg-violet-950/20" : "border-border", !p.isEnabled && !proposal && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {p.name}
                  {proposal && <span className="ml-2 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] text-violet-900">propuesta de la IA</span>}
                </span>
                {proposal ? (
                  <Button size="xs" onClick={() => void call(`/api/admin/whatsapp/playbooks/${p.id}`, "PATCH", { isEnabled: true })} disabled={busy} className="bg-[#128c4a] hover:bg-[#0f7a40]">
                    <Check /> Aprobar
                  </Button>
                ) : (
                  <Switch checked={p.isEnabled} disabled={busy} onCheckedChange={(v) => void call(`/api/admin/whatsapp/playbooks/${p.id}`, "PATCH", { isEnabled: v })} />
                )}
                <Button size="icon-xs" variant="ghost" aria-label="Editar" onClick={() => setEditing({ id: p.id, name: p.name, trigger: p.trigger, steps: p.steps })}>
                  <Pencil />
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="Borrar" onClick={() => void call(`/api/admin/whatsapp/playbooks/${p.id}`, "DELETE")} disabled={busy}>
                  <Trash2 />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Cuándo: {p.trigger}</p>
              <p className="text-xs whitespace-pre-wrap">{p.steps}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default WhatsAppPlaybooksCard;
