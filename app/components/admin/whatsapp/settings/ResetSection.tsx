"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { EXAMPLE_REASON_LABEL, type AiResetPlan, type ExampleReason } from "@/lib/crm/whatsapp-agent/ai-reset-rules";
import CrmConfirmDialog from "../../crm/CrmConfirmDialog";
import { useCrm } from "../../crm/CrmProvider";
import { WHATSAPP_AI_API, useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";

type PlanResponse = { plan: AiResetPlan; lastResetAt: string | null };

const post = (body: unknown) =>
  fetch(WHATSAPP_AI_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(
    () => null
  );

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * «Empezar limpio»: quita lo que la IA aprendió mal (propuestas repetidas,
 * ejemplos que no son de Dayana, la memoria que escribió viendo pocos
 * mensajes, el modo Copiloto pegado) para que aprenda del historial real.
 * Primero muestra qué quitaría; guarda una copia y se puede deshacer.
 */
const ResetSection = () => {
  const { preview } = useSettings();
  const { toast } = useCrm();
  const [data, setData] = useState<PlanResponse | null>(null);
  const [memories, setMemories] = useState(true);
  const [busy, setBusy] = useState<"plan" | "apply" | "undo" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const loadPlan = async () => {
    setBusy("plan");
    try {
      const res = await post({ action: "reset_plan" });
      if (!res?.ok) {
        toast("No se pudo revisar. Intenta de nuevo.", "error");
        return;
      }
      setData((await res.json()) as PlanResponse);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setConfirming(false);
    setBusy("apply");
    try {
      const res = await post({ action: "reset_apply", memories, confirm: "LIMPIAR" });
      if (!res?.ok) {
        toast("No se pudo limpiar. No se cambió nada.", "error");
        return;
      }
      toast("Listo: la IA quedó limpia. Ahora importa el historial y construye las fichas.", "success");
      await loadPlan();
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy("undo");
    try {
      const res = await post({ action: "reset_undo" });
      if (!res?.ok) {
        toast("No hay nada que deshacer.", "error");
        return;
      }
      const done = (await res.json().catch(() => ({}))) as { skippedPlaybooks?: number };
      toast(
        done.skippedPlaybooks
          ? `Se deshizo la limpieza. ${plural(done.skippedPlaybooks, "procedimiento que cambiaste después se quedó", "procedimientos que cambiaste después se quedaron")} como está.`
          : "Se deshizo la limpieza.",
        "success"
      );
      await loadPlan();
    } finally {
      setBusy(null);
    }
  };

  const plan = data?.plan;
  const nothing =
    plan &&
    !plan.proposals.length &&
    !plan.superseded.length &&
    !plan.textFixes.length &&
    !plan.examples.remove &&
    !plan.memories &&
    !plan.stickyModes;

  return (
    <SettingsGroup
      title="Empezar limpio"
      description="Quita lo que la IA aprendió mal para que aprenda del historial real de tus chats. No borra mensajes, contactos ni pagos, y se puede deshacer."
    >
      <SettingRow
        id="wa-reset"
        layout="stacked"
        label="Revisar lo que aprendió"
        help="Primero te muestra qué quitaría. Después: importa los chats del celular, clasifica, construye las fichas y calcula los estados."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadPlan()} disabled={preview || busy !== null}>
              {busy === "plan" && <Loader2 className="size-4 animate-spin" />} {plan ? "Volver a revisar" : "Revisar"}
            </Button>
            {data?.lastResetAt && (
              <Button variant="outline" size="sm" onClick={() => void undo()} disabled={preview || busy !== null}>
                {busy === "undo" && <Loader2 className="size-4 animate-spin" />} Deshacer la última limpieza
              </Button>
            )}
          </div>

          {plan && nothing && <p className="text-sm text-muted-foreground">No hay nada que limpiar.</p>}

          {plan && !nothing && (
            <div className="space-y-3 rounded-xl border border-border p-3 text-sm">
              <ul className="list-disc space-y-1.5 pl-5">
                {plan.proposals.length > 0 && (
                  <li>
                    Borrar {plural(plan.proposals.length, "propuesta de procedimiento sin aprobar", "propuestas de procedimientos sin aprobar")}{" "}
                    (muchas repetidas).
                  </li>
                )}
                {plan.superseded.length > 0 && (
                  <li>
                    Apagar {plan.superseded.map((p) => `«${p.name}»`).join(", ")}: ya están en las reglas de la IA y en el flujo de primera vez.
                  </li>
                )}
                {plan.textFixes.length > 0 && (
                  <li>Quitar de {plan.textFixes.map((p) => `«${p.name}»`).join(", ")} la referencia a los que se apagan.</li>
                )}
                {plan.examples.remove > 0 && (
                  <li>
                    Quitar {plural(plan.examples.remove, "ejemplo", "ejemplos")} de {plan.examples.total} que no son respuestas tuyas:{" "}
                    {(Object.entries(plan.examples.byReason) as [ExampleReason, number][])
                      .map(([reason, n]) => `${n} ${EXAMPLE_REASON_LABEL[reason]}`)
                      .join(" · ")}
                    .
                  </li>
                )}
                {plan.stickyModes > 0 && (
                  <li>
                    Soltar el modo Copiloto que se quedó pegado en {plural(plan.stickyModes, "chat", "chats")} (el modo general sigue mandando).
                  </li>
                )}
              </ul>
              {plan.memories > 0 && (
                <label className="flex items-start gap-2">
                  <Checkbox checked={memories} onCheckedChange={(v) => setMemories(v === true)} className="mt-0.5" />
                  <span>
                    Borrar también la memoria que escribió la IA de {plural(plan.memories, "persona", "personas")}: la escribió viendo
                    solo los últimos mensajes. La reemplaza la ficha, que lee todo el chat. Las notas que escribiste tú se quedan.
                  </span>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Se queda igual: tu guía de estilo, tus instrucciones
                {plan.kept.playbooks.length > 0 ? `, los procedimientos ${plan.kept.playbooks.map((p) => `«${p}»`).join(", ")}` : ""}
                {plan.kept.disabledExamples > 0 ? `, los ${plan.kept.disabledExamples} ejemplos que apagaste` : ""}
                {plan.kept.staffMemories > 0 ? `, tus notas en ${plural(plan.kept.staffMemories, "persona", "personas")}` : ""}
                {plan.kept.staffModes > 0 ? `, el modo que elegiste en ${plural(plan.kept.staffModes, "chat", "chats")}` : ""}.
              </p>
              <Button size="sm" variant="destructive" onClick={() => setConfirming(true)} disabled={preview || busy !== null}>
                {busy === "apply" && <Loader2 className="size-4 animate-spin" />} Limpiar
              </Button>
            </div>
          )}
        </div>
      </SettingRow>
      <CrmConfirmDialog
        open={confirming}
        title="¿Limpiar lo que aprendió la IA?"
        message="Se guarda una copia de todo lo que se quita y puedes deshacerlo desde aquí."
        confirmLabel="Limpiar"
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={apply}
      />
    </SettingsGroup>
  );
};

export default ResetSection;
