/**
 * The one activity row per assistant message: which steps ran, what to say
 * while one is running, and how long the turn took. Pure (steps.test.ts).
 */
import { AGENT_PROFILES, isAgentId, toolLabel } from "@/agent/lib/catalog";
import { approvalStatus, isApprovalPart, isQuestionPart, type ToolPartLike } from "./approval";

export type StepStatus = "running" | "waiting" | "done" | "error" | "denied";
export type StepKind = "tool" | "specialist" | "skill";

export type ActivityStep = {
  id: string;
  kind: StepKind;
  name: string;
  /** Finished form, shown in the expanded list: «Buscar contactos», «Ventas trabajó en esto». */
  label: string;
  /** While it runs: «Buscando contactos…», «Ventas está trabajando…». */
  runningLabel: string;
  status: StepStatus;
  part: ToolPartLike;
};

export type Activity = {
  steps: ActivityStep[];
  /** A step is running or waiting on the operator. */
  running: boolean;
  /** The label for the shimmer line while running, else null. */
  currentLabel: string | null;
  errorCount: number;
};

/** Parts that never become a step: `todo` renders as a plan, `ask_question` as prose. */
const NOT_A_STEP = new Set(["todo", "ask_question"]);

const NOUNS_ENDING_LIKE_VERBS = new Set(["taller", "lugar", "hogar", "mujer", "placer", "poder"]);

const IRREGULAR_GERUNDS: Record<string, string> = {
  pedir: "pidiendo",
  leer: "leyendo",
  ver: "viendo",
  ir: "yendo",
  convertir: "convirtiendo",
  traer: "trayendo",
  decir: "diciendo",
  seguir: "siguiendo",
  servir: "sirviendo",
  repetir: "repitiendo",
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** «Buscar contactos» → «Buscando contactos»; null when the label doesn't start with an infinitive. */
export const toGerund = (label: string): string | null => {
  const match = /^(\S+)(.*)$/.exec(label.trim());
  if (!match) return null;
  const [, first, rest] = match;
  const word = first.toLowerCase();
  if (NOUNS_ENDING_LIKE_VERBS.has(word)) return null;
  let gerund = IRREGULAR_GERUNDS[word];
  if (!gerund) {
    if (word.length > 2 && word.endsWith("ar")) gerund = `${word.slice(0, -2)}ando`;
    else if (word.length > 2 && (word.endsWith("er") || word.endsWith("ir"))) gerund = `${word.slice(0, -2)}iendo`;
  }
  return gerund ? `${capitalize(gerund)}${rest}` : null;
};

const RUNNING_OVERRIDES: Record<string, string> = {
  memory: "Revisando la memoria",
  send_whatsapp_bulk: "Enviando el WhatsApp masivo",
  send_bulk_email: "Enviando la campaña de correo",
  dashboard_stats: "Revisando el resumen del panel",
  crm_stats: "Calculando estadísticas",
  load_skill: "Leyendo instrucciones",
  agent: "Trabajando en una subtarea",
};

const DONE_FALLBACKS: Record<string, string> = {
  load_skill: "Leer instrucciones",
  agent: "Subtarea",
};

const humanize = (name: string): string => capitalize(name.replace(/[_-]+/g, " ").trim());

export const isSpecialistPart = (part: Pick<ToolPartLike, "toolName" | "toolMetadata">): boolean =>
  (isAgentId(part.toolName) && part.toolName !== "auto") || part.toolMetadata?.eve?.kind === "subagent-call";

const specialistName = (part: ToolPartLike): string => {
  const id = isAgentId(part.toolName) ? part.toolName : part.toolMetadata?.eve?.name;
  return id && isAgentId(id) ? AGENT_PROFILES[id].label : humanize(part.toolMetadata?.eve?.name ?? part.toolName);
};

/** Finished-step label for a tool name (catalog label, or a readable fallback). */
export const stepDoneLabel = (toolName: string): string =>
  (isAgentId(toolName) ? undefined : toolLabel(toolName)) ?? DONE_FALLBACKS[toolName] ?? humanize(toolName);

/** Running label for a tool name, without the trailing ellipsis. */
export const stepRunningLabel = (toolName: string): string => {
  if (RUNNING_OVERRIDES[toolName]) return RUNNING_OVERRIDES[toolName];
  const label = stepDoneLabel(toolName);
  return toGerund(label) ?? `Revisando ${lowerFirst(label)}`;
};

const statusOf = (part: ToolPartLike, isLive: boolean): StepStatus => {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "running";
    case "approval-requested":
      return approvalStatus(part, isLive) === "pending" ? "waiting" : "denied";
    case "approval-responded":
      return approvalStatus(part, isLive) === "denied" ? "denied" : "running";
    case "output-available":
      return "done";
    case "output-error":
      return "error";
    case "output-denied":
      return "denied";
  }
};

type PartLike = { readonly type: string };

const isToolPart = (part: PartLike): part is ToolPartLike => part.type === "dynamic-tool";

/**
 * `pendingCallId` = the tool call the run is blocked on right now (see
 * `findPendingCallId`); only that one reads as «Esperando tu aprobación».
 */
export const buildActivity = (parts: readonly PartLike[], pendingCallId: string | null = null): Activity => {
  const steps: ActivityStep[] = [];
  for (const part of parts) {
    if (!isToolPart(part)) continue;
    if (NOT_A_STEP.has(part.toolName) || isQuestionPart(part)) continue;
    const isLive = part.toolCallId === pendingCallId;
    const status = statusOf(part, isLive);
    if (isSpecialistPart(part)) {
      const name = specialistName(part);
      steps.push({
        id: part.toolCallId,
        kind: "specialist",
        name: part.toolName,
        label: status === "running" || status === "waiting" ? `${name} está trabajando` : `${name} trabajó en esto`,
        runningLabel: `${name} está trabajando`,
        status,
        part,
      });
      continue;
    }
    const kind: StepKind = part.toolMetadata?.eve?.kind === "load-skill" ? "skill" : "tool";
    const toolName = kind === "skill" ? "load_skill" : part.toolName;
    steps.push({
      id: part.toolCallId,
      kind,
      name: part.toolName,
      label: stepDoneLabel(toolName),
      runningLabel: stepRunningLabel(toolName),
      status,
      part,
    });
  }

  const waiting = steps.find((s) => s.status === "waiting");
  const running = [...steps].reverse().find((s) => s.status === "running");
  return {
    steps,
    running: Boolean(waiting || running),
    currentLabel: waiting ? "Esperando tu aprobación" : running ? `${running.runningLabel}…` : null,
    errorCount: steps.filter((s) => s.status === "error").length,
  };
};

/** The single input request the run is blocked on: only ever the last part of the last message. */
export const findPendingCallId = (
  messages: readonly { parts: readonly PartLike[] }[]
): string | null => {
  const last = messages[messages.length - 1];
  if (!last) return null;
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const part = last.parts[i];
    if (isToolPart(part) && part.state === "approval-requested") return part.toolCallId;
  }
  return null;
};

export const isApprovalToolPart = (part: PartLike): part is ToolPartLike =>
  isToolPart(part) && isApprovalPart(part);

// ── specialist report ───────────────────────────────────────────────────────

/** What a specialist answered, as text, when its output carries one. */
export const specialistReport = (output: unknown): string | null => {
  if (typeof output === "string") return output.trim() || null;
  if (!output || typeof output !== "object") return null;
  const obj = output as Record<string, unknown>;
  for (const key of ["report", "text", "answer", "message", "result", "output"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const nested = specialistReport(value);
      if (nested) return nested;
    }
  }
  return null;
};

// ── todo plan ───────────────────────────────────────────────────────────────

export type PlanItem = { content: string; status: "pending" | "in_progress" | "completed" | "cancelled" };

const PLAN_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

const planFrom = (value: unknown): PlanItem[] | null => {
  if (!value || typeof value !== "object") return null;
  const todos = (value as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return null;
  const items: PlanItem[] = [];
  for (const todo of todos) {
    if (!todo || typeof todo !== "object") continue;
    const { content, status } = todo as Record<string, unknown>;
    if (typeof content === "string" && typeof status === "string" && PLAN_STATUSES.has(status)) {
      items.push({ content, status: status as PlanItem["status"] });
    }
  }
  return items;
};

/** The newest todo list in the message (its output wins over its input), or null. */
export const latestPlan = (parts: readonly PartLike[]): PlanItem[] | null => {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!isToolPart(part) || part.toolName !== "todo") continue;
    const plan = planFrom(part.output) ?? planFrom(part.input);
    if (plan && plan.length > 0) return plan;
  }
  return null;
};

// ── timing ──────────────────────────────────────────────────────────────────

type EventLike = { type: string; data?: unknown; meta?: { at?: string } };

export type TurnTiming = {
  /** Wall time of the turn, minus the time spent waiting on the operator. */
  totalMs: number;
  /** Time between the first reasoning delta and reasoning.completed, summed per step. */
  reasoningMs: number;
};

const turnIdOf = (event: EventLike): string | undefined => {
  const data = event.data as { turnId?: unknown } | undefined;
  return typeof data?.turnId === "string" ? data.turnId : undefined;
};

/** Per-turn durations from `meta.at` stamps; turns without stamps are left out. */
export const turnTimings = (events: readonly EventLike[]): Map<string, TurnTiming> => {
  type Acc = { first: number; last: number; waitStart: number | null; waited: number; reasoning: Map<string, [number, number]> };
  const acc = new Map<string, Acc>();
  for (const event of events) {
    const turnId = turnIdOf(event);
    const at = event.meta?.at ? Date.parse(event.meta.at) : NaN;
    if (!turnId || Number.isNaN(at)) continue;
    let entry = acc.get(turnId);
    if (!entry) {
      entry = { first: at, last: at, waitStart: null, waited: 0, reasoning: new Map() };
      acc.set(turnId, entry);
    }
    if (entry.waitStart !== null) {
      entry.waited += Math.max(0, at - entry.waitStart);
      entry.waitStart = null;
    }
    entry.last = Math.max(entry.last, at);
    if (event.type === "input.requested") entry.waitStart = at;
    if (event.type === "reasoning.appended" || event.type === "reasoning.completed") {
      const step = String((event.data as { stepIndex?: unknown }).stepIndex ?? "0");
      const span = entry.reasoning.get(step);
      entry.reasoning.set(step, span ? [span[0], Math.max(span[1], at)] : [at, at]);
    }
  }
  const out = new Map<string, TurnTiming>();
  for (const [turnId, entry] of acc) {
    let reasoningMs = 0;
    for (const [start, end] of entry.reasoning.values()) reasoningMs += end - start;
    out.set(turnId, { totalMs: Math.max(0, entry.last - entry.first - entry.waited), reasoningMs });
  }
  return out;
};

/** «4 s», «1 min 5 s»; anything under a second reads «1 s». */
export const formatDuration = (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
};

/** «3 pasos · 12 s», «1 paso». */
export const activitySummary = (stepCount: number, durationMs?: number | null): string => {
  const count = stepCount === 1 ? "1 paso" : `${stepCount} pasos`;
  return durationMs != null && durationMs > 0 ? `${count} · ${formatDuration(durationMs)}` : count;
};
