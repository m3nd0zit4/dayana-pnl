"use client";

import { Loader2, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import type { CategoryCounts } from "@/lib/crm/chat-category";
import { CHAT_CATEGORIES, CHAT_CATEGORY_LABEL } from "@/lib/crm/chat-category-rules";
import { useCrm } from "../../crm/CrmProvider";
import { useSettings } from "./context";
import SettingRow, { SettingsGroup } from "./SettingRow";
import ToggleRow from "./ToggleRow";

const API = "/api/admin/whatsapp/categories";

type RunResponse = {
  ok?: boolean;
  done?: boolean;
  busy?: boolean;
  retryAfterMs?: number;
  classified?: number;
  remaining?: number;
  needsAi?: number;
  aiDisabled?: boolean;
  aiBlocked?: "billing" | "auth" | "rate" | "errors" | null;
  counts?: CategoryCounts;
  error?: string;
};

const AI_BLOCKED: Record<string, string> = {
  billing: "Google bloqueó la IA por facturación: los dudosos quedan para después.",
  auth: "La clave de la IA no sirve: los dudosos quedan para después.",
  rate: "La IA pidió una pausa (cuota): vuelve a intentarlo en un rato.",
  errors: "La IA falló varias veces seguidas: vuelve a intentarlo en un rato.",
};

const post = async (body: unknown) => {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = ((await res?.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { res, data };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** «Clientes 12 · Interesadas 40 · …» con lo que hay hoy. */
const Summary = ({ counts }: { counts: CategoryCounts }) => (
  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
    {CHAT_CATEGORIES.map((c) => (
      <li key={c}>
        {CHAT_CATEGORY_LABEL[c]} <span className="font-medium text-foreground tabular-nums">{counts.counts[c] ?? 0}</span>
      </li>
    ))}
    <li>
      Sin clasificar <span className="font-medium text-foreground tabular-nums">{counts.unclassified}</span>
    </li>
    <li>
      Por revisar <span className="font-medium text-foreground tabular-nums">{counts.review}</span>
    </li>
  </ul>
);

/**
 * «Clasificar chats» (solo la dueña: la página de Ajustes ya lo es). Apagada
 * por defecto: con ella apagada no sale nada a Google y nada se silencia; las
 * categorías, si las hay, solo informan.
 */
const ClassifySection = () => {
  const { preview } = useSettings();
  const { toast } = useCrm();
  const [counts, setCounts] = useState<CategoryCounts | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState<null | "enable" | "run" | "team">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [team, setTeam] = useState("");
  const [teamMessage, setTeamMessage] = useState<{ tone: "error" | "warning"; text: string } | null>(null);
  const stop = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(API, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return null;
    const data = (await res.json()) as CategoryCounts;
    setCounts(data);
    return data;
  }, []);

  useEffect(() => {
    void load().then((data) => {
      if (data) setTeam(data.teamPhones.join("\n"));
    });
  }, [load]);

  const enable = async (enabled: boolean) => {
    setBusy("enable");
    try {
      const { res } = await post({ action: "enable", enabled });
      if (!res?.ok) {
        toast("No se pudo cambiar. ¿Eres la dueña de la cuenta?", "error");
        return;
      }
      await load();
      toast(enabled ? "Clasificación encendida" : "Clasificación apagada: nada se silencia", "success");
    } finally {
      setBusy(null);
    }
  };

  /** Repite tandas hasta terminar; si otra tanda (el reloj) está corriendo, espera lo que pide. */
  const classifyAll = async () => {
    setBusy("run");
    stop.current = false;
    let classified = 0;
    try {
      for (;;) {
        const { res, data } = await post({ action: "classify_all" });
        const run = data as RunResponse;
        if (!res?.ok) {
          toast("Se cortó la clasificación. Vuelve a intentarlo: sigue donde iba.", "error");
          return;
        }
        if (run.counts) setCounts(run.counts);
        if (run.busy) {
          const wait = run.retryAfterMs ?? Number(res.headers.get("Retry-After") ?? 15) * 1000;
          setProgress(`Otra clasificación está corriendo; sigo en ${Math.ceil(wait / 1000)} s…`);
          await sleep(wait);
          if (stop.current) break;
          continue;
        }
        classified += run.classified ?? 0;
        setProgress(
          `${classified} clasificados · faltan ${run.remaining ?? 0}${run.aiDisabled ? " (solo reglas: la IA no se usa)" : ""}`
        );
        if (run.aiBlocked) toast(AI_BLOCKED[run.aiBlocked] ?? "La IA se cortó en esta vuelta.", "info");
        if (run.done || stop.current) break;
      }
      toast(stop.current ? "Detenido. Puedes seguir cuando quieras." : `Listo: ${classified} chats clasificados`, "success");
    } finally {
      setBusy(null);
    }
  };

  const saveTeam = async () => {
    setBusy("team");
    setTeamMessage(null);
    try {
      const phones = team
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      const { res, data } = await post({ action: "team_phones", phones });
      if (res?.status === 400 && data.error === "invalid_phones") {
        const invalid = (data.invalid as string[] | undefined) ?? [];
        setTeamMessage({
          tone: "error",
          text: `Ponles el código de país (p. ej. +57 300…): ${invalid.join(", ")}`,
        });
        return;
      }
      if (!res?.ok) {
        toast("No se pudieron guardar los números.", "error");
        return;
      }
      const saved = (data.phones as string[] | undefined) ?? phones;
      setTeam(saved.join("\n"));
      const warnings = (data.warnings as { phone: string; name: string }[] | undefined) ?? [];
      if (warnings.length) {
        setTeamMessage({
          tone: "warning",
          text: `Ojo: ${warnings.map((w) => `${w.name} (${w.phone})`).join(", ")} ya pagó. Si es del equipo, la IA no le contestará.`,
        });
      }
      await load();
      toast("Números del equipo guardados", "success");
    } finally {
      setBusy(null);
    }
  };

  const enabled = Boolean(counts?.enabled);

  return (
    <SettingsGroup
      title="Clasificar chats"
      description="Cliente, interesada, comunidad, personal, negocio/app o equipo."
    >
      <ToggleRow
        id="wa-classify"
        label="Clasificar los chats"
        help="Encendida, los chats dudosos se mandan a Google para clasificarlos, también en el momento en que vuelve a escribir alguien que la IA había callado. Apagada, no sale nada a Google y nada se silencia."
        info="Encendida, la IA deja de contestar —y no te aparecen en «Te toca» como «sin responder»— los chats que son claramente personales, de negocios o apps (códigos, notificaciones) o del equipo. Solo cuando está segura; lo dudoso queda «por revisar» y se atiende como siempre. Si alguien que la IA calló vuelve a escribir, la IA lo vuelve a mirar antes de contestar; si no puede (tarda, falla), contesta como siempre. Un pago, una urgencia o algo por aprobar te aparecen siempre."
        checked={enabled}
        disabled={!counts || busy !== null || preview}
        onChange={(v) => void enable(v)}
      />
      <SettingRow
        id="wa-classify-preview"
        layout="stacked"
        label="Vista previa"
        help={counts ? `${counts.total} chats · ${counts.pending} por mirar` : "Cargando…"}
      >
        {showPreview && counts ? (
          <Summary counts={counts} />
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!counts}
            onClick={() => {
              setShowPreview(true);
              void load();
            }}
          >
            Ver vista previa
          </Button>
        )}
      </SettingRow>
      <SettingRow
        id="wa-classify-run"
        label="Clasificar todos ahora"
        help={
          progress ??
          (enabled
            ? "Reglas y, para lo dudoso, la IA. Puede tardar unos minutos."
            : "Con la clasificación apagada, solo reglas (no sale nada a Google).")
        }
      >
        {busy === "run" ? (
          <Button variant="outline" size="sm" onClick={() => (stop.current = true)}>
            <Loader2 className="animate-spin" /> <Square /> Detener
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy !== null || preview} onClick={() => void classifyAll()}>
            <Sparkles /> Clasificar todos
          </Button>
        )}
      </SettingRow>
      <SettingRow
        id="wa-team-phones"
        layout="stacked"
        label="Números del equipo"
        help="Uno por línea, con código de país. Sus chats son «equipo»: la IA no les contesta."
        htmlFor="wa-team-phones-input"
      >
        <div className="space-y-2">
          <Textarea
            id="wa-team-phones-input"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            rows={3}
            placeholder={"+57 300 000 0000"}
            className="text-base md:text-sm"
          />
          {teamMessage && (
            <p
              role="alert"
              className={teamMessage.tone === "error" ? "text-xs text-destructive" : "text-xs text-warning"}
            >
              {teamMessage.text}
            </p>
          )}
          <Button size="sm" variant="outline" disabled={busy !== null || preview} onClick={() => void saveTeam()}>
            {busy === "team" && <Loader2 className="animate-spin" />} Guardar números
          </Button>
        </div>
      </SettingRow>
    </SettingsGroup>
  );
};

export default ClassifySection;
