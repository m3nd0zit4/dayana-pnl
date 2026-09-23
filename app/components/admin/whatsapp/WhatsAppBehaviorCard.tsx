"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCrm } from "../crm/CrmProvider";

/**
 * Dos decisiones que no estaban en los ajustes: cómo arranca un chat nuevo
 * (IA sola o copiloto) y qué se le dice a la persona cuando la IA pasa el
 * chat a Dayana (nada, por defecto).
 */
const WhatsAppBehaviorCard = ({
  initialMode,
  initialHolding,
}: {
  initialMode: "AUTO" | "COPILOT" | "MANUAL";
  initialHolding: string;
}) => {
  const { toast } = useCrm();
  const [mode, setMode] = useState(initialMode);
  const [holding, setHolding] = useState(initialHolding);
  const [saving, setSaving] = useState(false);
  const dirty = mode !== initialMode || holding !== initialHolding;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/whatsapp/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: { defaultMode: mode, escalation: { holdingMessage: holding } },
        }),
      });
      if (!res.ok) throw new Error();
      toast("Guardado", "success");
    } catch {
      toast("No se pudo guardar.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="font-semibold">Cómo trabaja con los chats</h2>
      <div className="space-y-1.5">
        <p className="text-sm">Chats nuevos:</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["AUTO", "La IA responde sola", "Tú solo entras cuando te pasa un chat."],
              ["COPILOT", "La IA propone, tú envías", "Cada respuesta queda como borrador para que la revises."],
            ] as const
          ).map(([value, title, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "max-w-xs rounded-lg border p-3 text-left text-sm",
                mode === value ? "border-[#128c4a] bg-emerald-50/60 dark:bg-emerald-950/20" : "border-border"
              )}
            >
              <div className="font-medium">{title}</div>
              <div className="text-xs text-muted-foreground">{hint}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Cada chat se puede cambiar aparte desde su cabecera.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm">Cuando la IA te pasa un chat (pago, algo que no sabe, algo delicado), a la persona se le dice:</p>
        <Textarea
          value={holding}
          onChange={(e) => setHolding(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="Nada (recomendado): la IA se calla y tú respondes. Si quieres, escribe aquí un mensaje corto."
        />
      </div>
      <Button onClick={save} disabled={!dirty || saving}>
        {saving && <Loader2 className="animate-spin" />} Guardar
      </Button>
    </section>
  );
};

export default WhatsAppBehaviorCard;
