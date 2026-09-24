"use client";

import { AlertTriangle, Bot, CheckCheck, Clock, FilePen, Loader2, Send, Hand, XCircle, PauseCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { RunView } from "@/lib/crm/whatsapp-agent/workspace";
import { deliveryLabel, failedLabel } from "@/lib/crm/whatsapp-delivery-labels";

/** Lo que cada estado de la IA significa, dicho para Dayana. */

export const CATEGORY_LABEL: Record<string, string> = {
  payment: "Pago",
  unknown: "No sabe qué responder",
  complaint: "Queja",
  clinical: "Tema delicado",
  reschedule: "Cambio de cita",
  other: "Pendiente",
  error: "Falló la IA",
};

export const SKIP_LABEL: Record<string, string> = {
  disabled: "IA apagada",
  manual: "Lo atiendes tú",
  favorite: "Favorito: la IA no lo toca",
  paused: "IA en pausa",
  owner_hours: "Tu horario: contestas tú",
  assigned: "Asignado a alguien del equipo",
  no_inbound: "Nada nuevo que contestar",
  human_replied: "Contestaste tú hace poco",
  known_contact: "Está en tu libreta (familia o amigos)",
  customer: "Es clienta: la atiendes tú",
  no_model_key: "Falta la clave del modelo",
  not_found: "Chat no encontrado",
};

export const MODE_LABEL = {
  AUTO: "IA responde sola",
  COPILOT: "IA sugiere, tú envías",
  MANUAL: "Lo atiendes tú",
} as const;

/** Reloj que avanza cada segundo mientras algo está en curso. */
export const useNow = (active: boolean, everyMs = 1000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
};

export const secondsLabel = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60 ? `${s % 60} s` : ""}`.trim();
};

export const agoLabel = (iso: string, now: number) => {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "hace un momento";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
};

const IN_PROGRESS = new Set(["QUEUED", "THINKING", "SENDING"]);

export const isRunLive = (run: RunView | null) =>
  Boolean(run && IN_PROGRESS.has(run.status) && Date.now() - new Date(run.queuedAt).getTime() < 5 * 60_000);

/**
 * Una línea con lo que está haciendo la IA en este chat, con tiempos en vivo:
 * «Leyendo… 3 s», «Pensando… 6 s», «Respondió hace 2 min · tardó 9 s».
 */
/** « · le llegó» / « · lo leyó»: la misma frase que en el chat y en la ficha. */
const deliveredLabel = (d: RunView["delivery"]) =>
  d && d.status !== "FAILED" ? ` · ${deliveryLabel(d.status).label.toLowerCase()}` : "";

export { failedLabel };

export const RunStatus = ({
  run,
  compact = false,
  className,
}: {
  run: RunView | null;
  compact?: boolean;
  className?: string;
}) => {
  const live = isRunLive(run);
  const now = useNow(live || Boolean(run), live ? 1000 : 30_000);
  if (!run) return null;

  const since = (iso: string | null) => (iso ? secondsLabel(now - new Date(iso).getTime()) : "");
  const took = run.latencyMs != null ? ` · tardó ${secondsLabel(run.latencyMs)}` : "";
  const ended = run.finishedAt ? agoLabel(run.finishedAt, now) : "";

  let icon = <Bot className="size-3.5" />;
  let text = "";
  let tone = "text-[#667781] dark:text-muted-foreground";

  switch (run.status) {
    case "QUEUED":
      icon = <Clock className="size-3.5 animate-pulse" />;
      text = `Esperando que termine de escribir… ${since(run.queuedAt)}`;
      tone = "text-[#008069] dark:text-emerald-300";
      break;
    case "THINKING":
      icon = <Loader2 className="size-3.5 animate-spin" />;
      text = `Pensando la respuesta… ${since(run.startedAt ?? run.queuedAt)}`;
      tone = "text-[#008069] dark:text-emerald-300";
      break;
    case "SENDING":
      icon = <Send className="size-3.5 animate-pulse" />;
      text = `Enviando… ${since(run.queuedAt)}`;
      tone = "text-[#008069] dark:text-emerald-300";
      break;
    case "REPLIED":
      icon = <CheckCheck className="size-3.5" />;
      text = compact ? `IA respondió ${ended}` : `La IA respondió ${ended}${took}${deliveredLabel(run.delivery)}`;
      tone = "text-[#008069] dark:text-emerald-300";
      break;
    case "DRAFTED":
      icon = <FilePen className="size-3.5" />;
      text = compact ? "Borrador listo" : `Borrador listo para que lo envíes ${ended}${took}`;
      tone = "text-[#6d28d9] dark:text-violet-300";
      break;
    case "ESCALATED":
      icon = <AlertTriangle className="size-3.5" />;
      text = `Te toca: ${CATEGORY_LABEL[run.category ?? ""] ?? "revisar"}${compact ? "" : ` · ${ended}`}`;
      tone = run.severity === "urgent" ? "text-[#d92d20] dark:text-red-300" : "text-[#008069] dark:text-emerald-300";
      break;
    case "ERROR":
      icon = <XCircle className="size-3.5" />;
      text = compact ? "La IA falló" : `La IA falló ${ended}: ${run.reason ?? ""}`;
      tone = "text-red-700 dark:text-red-300";
      break;
    case "AWAITING_APPROVAL":
      icon = <FilePen className="size-3.5" />;
      text = compact ? "Espera tu aprobación" : `Espera tu aprobación · ${ended}`;
      tone = "text-[#6d28d9] dark:text-violet-300";
      break;
    case "APPROVED":
      icon = <CheckCheck className="size-3.5" />;
      text = compact
        ? "Aprobado"
        : `Aprobaste la propuesta ${agoLabel(run.finishedAt ?? run.queuedAt, now)}${deliveredLabel(run.delivery)}`;
      tone = "text-[#008069] dark:text-emerald-300";
      break;
    case "CANCELLED":
      icon = <XCircle className="size-3.5" />;
      text = "Cancelaste la propuesta";
      break;
    case "SUPERSEDED":
      icon = <Hand className="size-3.5" />;
      text = run.reason ?? "Respondiste tú";
      break;
    case "SKIPPED":
      icon = run.reason === "manual" ? <Hand className="size-3.5" /> : <PauseCircle className="size-3.5" />;
      text = `${SKIP_LABEL[run.reason ?? ""] ?? run.reason ?? "No respondió"}${compact ? "" : ` · ${ended}`}`;
      break;
  }

  if (run.delivery?.status === "FAILED" && (run.status === "APPROVED" || run.status === "REPLIED")) {
    icon = <XCircle className="size-3.5" />;
    text = compact
      ? "No se entregó"
      : `${run.status === "APPROVED" ? "Lo aprobaste" : "La IA respondió"} · ${deliveryLabel("FAILED", run.delivery.error).label}. Reenvíalo desde el mensaje`;
    tone = "text-[#d92d20] dark:text-red-300";
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", tone, className)}>
      {icon}
      <span className="truncate">{text}</span>
    </span>
  );
};
