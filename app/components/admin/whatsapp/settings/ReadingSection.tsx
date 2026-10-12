"use client";

import { Loader2, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { useCrm } from "../../crm/CrmProvider";
import { useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow from "./ToggleRow";

const API = "/api/admin/whatsapp/dossiers";

type BuildResponse = { built?: number; pending?: number; error?: string };

/**
 * Lo que la IA lee de cada chat: el historial completo (no solo dos semanas)
 * y la ficha de cada persona, armada con todo su chat (también lo importado
 * del celular). «Construir fichas» las arma de una vez después de importar.
 */
const ReadingSection = () => {
  const { config, change, states, preview } = useSettings();
  const { toast } = useCrm();
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const stop = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(API, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setPending(((await res.json()) as { pending: number }).pending);
  }, []);

  useEffect(() => {
    if (!preview) void load();
  }, [load, preview]);

  /** Repite tandas de ~55 s hasta que no quede ninguna (o hasta «Detener»). */
  const build = async () => {
    setBusy(true);
    stop.current = false;
    let built = 0;
    try {
      for (;;) {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "build" }),
        }).catch(() => null);
        const data = ((await res?.json().catch(() => null)) ?? {}) as BuildResponse;
        if (!res?.ok) {
          toast(
            data.error === "no_model_key" ? "Falta la clave de la IA." : "Se cortó. Vuelve a intentarlo: sigue donde iba.",
            "error"
          );
          return;
        }
        built += data.built ?? 0;
        setPending(data.pending ?? 0);
        setProgress(`${built} fichas al día · faltan ${data.pending ?? 0}`);
        if (!data.pending || stop.current || !data.built) break;
      }
      toast(stop.current ? "Detenido. Puedes seguir cuando quieras." : `Listo: ${built} fichas al día`, "success");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup title="Lo que lee de cada chat">
      <ToggleRow
        id="wa-context-v2"
        label="Leer el historial completo del chat"
        help={`Lee los últimos ${config.context.recentMessages} mensajes, sean de cuando sean, y no saluda como nueva a quien ya habló contigo.`}
        info="Apagado, lee solo las últimas 2 semanas (o los últimos 40 mensajes). Encendido, también busca en lo más viejo del chat lo que toca el tema que la persona trae."
        state={states["wa-context-v2"]}
        checked={config.context.v2}
        onChange={(v) => change("wa-context-v2", "context.v2", v)}
      />
      <ToggleRow
        id="wa-dossier"
        label="Ficha de cada persona"
        help="Un resumen armado con todo su chat (también lo importado del celular): de dónde escribe, qué la trae, qué se le ofreció y qué se le prometió."
        info="La IA la lee antes de contestar. Se pone al día sola después de cada respuesta y cada 10 minutos. Lo que la mueve a buscar ayuda queda como nota interna: nunca se le dice a la persona."
        state={states["wa-dossier"]}
        checked={config.dossier.enabled}
        onChange={(v) => change("wa-dossier", "dossier.enabled", v)}
      />
      <SettingRow
        id="wa-dossier-build"
        label="Construir fichas"
        help={
          progress ??
          (pending === null ? "Revisando…" : pending === 0 ? "Todas las fichas están al día." : `${pending} chats sin ficha o con mensajes nuevos.`)
        }
        layout="row"
      >
        {busy ? (
          <Button variant="outline" size="sm" onClick={() => (stop.current = true)}>
            <Loader2 className="size-4 animate-spin" />
            <Square className="size-3.5" /> Detener
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void build()} disabled={preview || !pending}>
            Construir ahora
          </Button>
        )}
      </SettingRow>
    </SettingsGroup>
  );
};

export default ReadingSection;
