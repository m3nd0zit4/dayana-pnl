import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";
import { startOwnerConversation } from "@/lib/crm/agent-messages";
import { siteUrl } from "@/lib/notifications/config";
import { getAgentVoiceSettings } from "../settings";
import { overLimit, withinOwnerHours } from "../settings-rules";
import { toSpeechText } from "../speech-text";
import { CallNotConfiguredError, providerFor, type CallProvider } from "./providers";

/**
 * El asistente llama a Dayana. Sin tabla propia: cada llamada es una fila de
 * auditoría (`AGENT_CALL`, id = la clave que viaja en la URL del webhook) y su
 * respuesta otra (`AGENT_CALL_ANSWER`). Lo que ella dice al teléfono NO
 * aprueba nada: llega al panel como el primer mensaje de una conversación con
 * el asistente, y cualquier acción sigue pidiendo su toque en pantalla.
 */

export const CALL_AUDIT = "AGENT_CALL";
export const CALL_ANSWER_AUDIT = "AGENT_CALL_ANSWER";
export const CALL_MESSAGE_MAX = 400;
/** Una respuesta que llega más tarde que esto no se acepta (clave vieja o reenviada). */
export const CALL_ANSWER_TTL_MS = 2 * 3600_000;

export type CallResult =
  | { placed: true; callKey: string; provider: CallProvider["id"]; providerCallId: string; simulated: boolean }
  | { placed: false; reason: "off" | "no_phone" | "quiet_hours" | "limit" | "not_configured" | "failed"; detail: string };

export type CallDeps = { provider?: CallProvider; now?: () => Date; baseUrl?: string };

const newKey = () => randomBytes(12).toString("base64url");

export const placeOwnerCall = async (
  input: { message: string; reason: "request" | "proactive"; source: string; staffUserId?: string | null },
  deps: CallDeps = {}
): Promise<CallResult> => {
  const settings = await getAgentVoiceSettings();
  const now = (deps.now ?? (() => new Date()))();
  if (settings.calls === "off") {
    return { placed: false, reason: "off", detail: "Las llamadas del asistente están apagadas (Ajustes → Canales del agente)." };
  }
  if (!settings.ownerPhone) {
    return { placed: false, reason: "no_phone", detail: "Falta el número personal de Dayana en Ajustes → Canales del agente." };
  }
  if (input.reason === "proactive" && !withinOwnerHours(settings, now)) {
    return { placed: false, reason: "quiet_hours", detail: "Fuera del horario en que se le puede llamar." };
  }
  const [lastHour, lastDay] = await Promise.all(
    [3600_000, 24 * 3600_000].map((ms) =>
      prisma.auditLog.count({ where: { entityType: CALL_AUDIT, createdAt: { gte: new Date(now.getTime() - ms) } } })
    )
  );
  const limit = overLimit("call", { lastHour, lastDay });
  if (limit) {
    return { placed: false, reason: "limit", detail: limit === "hour" ? "Ya hubo varias llamadas en la última hora." : "Ya se llegó al tope de llamadas de hoy." };
  }

  const provider = deps.provider ?? providerFor(settings.calls);
  const callKey = newKey();
  const message = toSpeechText(input.message, { maxChars: CALL_MESSAGE_MAX });
  try {
    const placed = await provider.place({ to: settings.ownerPhone, message, callKey, baseUrl: deps.baseUrl ?? siteUrl() });
    await writeAuditLog({
      staffUserId: input.staffUserId ?? undefined,
      action: "CREATE",
      entityType: CALL_AUDIT,
      entityId: callKey,
      changes: { provider: provider.id, providerCallId: placed.providerCallId, status: placed.status, message, reason: input.reason, source: input.source },
    });
    return { placed: true, callKey, provider: provider.id, providerCallId: placed.providerCallId, simulated: provider.id === "fake" };
  } catch (err) {
    if (err instanceof CallNotConfiguredError) return { placed: false, reason: "not_configured", detail: err.message };
    return { placed: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
};

/** La llamada de esa clave, si existe y es reciente. */
export const findOwnerCall = async (callKey: string, now: Date = new Date()) => {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(callKey)) return null;
  const row = await prisma.auditLog.findFirst({
    where: { entityType: CALL_AUDIT, entityId: callKey, createdAt: { gte: new Date(now.getTime() - CALL_ANSWER_TTL_MS) } },
    select: { changes: true, createdAt: true },
  });
  if (!row) return null;
  const changes = (row.changes ?? {}) as { message?: string; provider?: string; providerCallId?: string };
  return { message: changes.message ?? "", provider: changes.provider ?? "", providerCallId: changes.providerCallId ?? "", createdAt: row.createdAt };
};

/** El texto con el que el asistente abre la conversación en el panel. */
export const callAnswerMessage = (asked: string, heard: string | null): string =>
  heard
    ? `Te llamé por esto: «${asked}»\n\nMe respondiste por teléfono: «${heard}»\n\n¿Lo hago así? Si es una acción, te la dejo para aprobar aquí.`
    : `Te llamé por esto: «${asked}»\n\nNo te escuché responder en la llamada. ¿Qué hago?`;

/**
 * Lo que ella dijo (o no) en la llamada. Una sola respuesta por llamada: un
 * reintento de Twilio con la misma clave no abre otra conversación.
 */
export const recordOwnerCallAnswer = async (input: {
  callKey: string;
  heard: string | null;
  providerCallId?: string | null;
  now?: Date;
}): Promise<{ ok: boolean; reason?: "unknown_call" | "already_answered" }> => {
  const call = await findOwnerCall(input.callKey, input.now);
  if (!call) return { ok: false, reason: "unknown_call" };
  if (input.providerCallId && call.providerCallId && input.providerCallId !== call.providerCallId) {
    return { ok: false, reason: "unknown_call" };
  }
  const already = await prisma.auditLog.count({ where: { entityType: CALL_ANSWER_AUDIT, entityId: input.callKey } });
  if (already > 0) return { ok: false, reason: "already_answered" };
  const heard = input.heard?.trim().slice(0, 600) || null;
  await writeAuditLog({ action: "CREATE", entityType: CALL_ANSWER_AUDIT, entityId: input.callKey, changes: { heard } });
  await startOwnerConversation({
    agent: "auto",
    title: heard ? "Lo que me dijiste en la llamada" : "Te llamé y no te escuché",
    message: callAnswerMessage(call.message, heard),
    source: `call:${input.callKey}`,
  });
  return { ok: true };
};
