import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";
import type { NormalizedEvent } from "./inbound";
import { finishHistorySync, processNormalizedEvent } from "./ingest";
import { recoverStuck } from "./recover";
import { retryFailedMediaThrottled } from "./media-retry";

/**
 * Cola durable de entrada de WhatsApp (y Messenger/Instagram).
 *
 * El webhook solo guarda: el aviso crudo (`meta_webhook_payloads`) y un evento
 * por fila (`meta_inbox_events`), y ENTONCES responde 200. Si guardar falla,
 * responde 500 y 360dialog/Meta lo reintentan. El procesamiento va después y
 * puede fallar sin perder nada: cada evento se reintenta con espera creciente
 * hasta quedar guardado en su chat.
 *
 * No hay cron: la cola se vacía al final de cada webhook y la «barre» también
 * el stream de la sección de WhatsApp, la página Estado y el botón Reprocesar.
 */

export const MAX_ATTEMPTS = 12;
const LEASE_SECONDS = 120;

export type InboxState = "RECEIVED" | "PROCESSING" | "DONE" | "FAILED" | "DEAD";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/** La clave que impide que el mismo evento entre dos veces. */
export const dedupeKeyFor = (event: NormalizedEvent): string => {
  switch (event.kind) {
    case "message":
      return `msg:${event.externalMessageId}`;
    case "status":
      return `st:${event.externalMessageId}:${event.status}`;
    case "template":
      return `tpl:${event.name}:${event.status ?? ""}:${event.newCategory ?? ""}:${event.reason ?? ""}`;
    default:
      return `ct:${sha(event)}`;
  }
};

export const inboxKindOf = (event: NormalizedEvent): string =>
  event.kind === "message" && event.isHistory ? "history" : event.kind;

/** Espera antes del siguiente intento: 30 s, 1 min, 2 min… hasta 1 h. */
export const backoffMs = (attempts: number): number =>
  Math.min(2 ** Math.max(0, attempts) * 15_000, 3_600_000);

/** Las fechas vuelven como texto desde JSON: se reconstruyen. */
export const reviveEvent = (json: unknown): NormalizedEvent => {
  const e = { ...(json as Record<string, unknown>) };
  if (typeof e.sentAt === "string") e.sentAt = new Date(e.sentAt);
  if (typeof e.at === "string") e.at = new Date(e.at);
  return e as unknown as NormalizedEvent;
};

/**
 * Guarda el aviso y sus eventos. Lanza si no pudo guardar: el webhook debe
 * responder 500 para que lo reintenten.
 */
export const enqueueMetaEvents = async (input: {
  source: string;
  object: string;
  raw: unknown;
  events: NormalizedEvent[];
}): Promise<{ received: number; queued: number }> => {
  const payload = await prisma.metaWebhookPayload.create({
    data: { source: input.source, raw: input.raw as Prisma.InputJsonValue },
    select: { id: true },
  });
  const { count } = await prisma.metaInboxEvent.createMany({
    data: input.events.map((event) => ({
      dedupeKey: dedupeKeyFor(event),
      kind: inboxKindOf(event),
      wamid: event.kind === "message" || event.kind === "status" ? event.externalMessageId : null,
      object: input.object,
      payloadId: payload.id,
      normalized: event as unknown as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  return { received: input.events.length, queued: count };
};

type ClaimedRow = { id: string; kind: string; object: string; normalized: unknown; attempts: number };

/**
 * Reserva hasta `n` eventos listos (lo nuevo siempre; lo fallido cuando le
 * toca el reintento). `FOR UPDATE SKIP LOCKED` + arriendo: dos
 * procesos a la vez nunca toman el mismo, y uno que se cayó a medias libera
 * sus eventos cuando vence el arriendo. Primero mensajes, luego acuses (un
 * acuse necesita su mensaje) y al final el historial (no tiene prisa).
 */
export const claimBatch = async (n: number): Promise<ClaimedRow[]> =>
  prisma.$queryRaw<ClaimedRow[]>`
    UPDATE meta_inbox_events
       SET state = 'PROCESSING',
           lease_until = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + make_interval(secs => ${LEASE_SECONDS}),
           attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM meta_inbox_events
        WHERE state = 'RECEIVED'
           OR (state = 'FAILED' AND next_attempt_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
           OR (state = 'PROCESSING' AND lease_until < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
        ORDER BY CASE kind WHEN 'history' THEN 2 WHEN 'status' THEN 1 ELSE 0 END, received_at
        LIMIT ${n}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, kind, object, normalized, attempts`;

const markDone = (id: string, outcome: string) =>
  prisma.metaInboxEvent.update({
    where: { id },
    data: { state: "DONE", outcome: outcome.slice(0, 120), processedAt: new Date(), leaseUntil: null, lastError: null },
  });

const markRetry = (row: ClaimedRow, error: string) => {
  const dead = row.attempts >= MAX_ATTEMPTS;
  return prisma.metaInboxEvent.update({
    where: { id: row.id },
    data: {
      state: dead ? "DEAD" : "FAILED",
      lastError: error.slice(0, 500),
      leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)),
    },
  });
};

/** Un acuse de un mensaje que aún no está guardado se reintenta; tras 8 intentos se da por perdido. */
const STATUS_WAIT_ATTEMPTS = 8;

export type DrainStats = { processed: number; stored: number; retried: number; dead: number };

let draining = false;

/**
 * Procesa la cola hasta vaciarla o agotar el tiempo. La IA de cada chat
 * afectado corre al final, en paralelo, para no frenar los demás mensajes.
 */
export const drainInbox = async (opts: { budgetMs?: number; batchSize?: number } = {}): Promise<DrainStats> => {
  const stats: DrainStats = { processed: 0, stored: 0, retried: 0, dead: 0 };
  if (draining) return stats; // una sola pasada por instancia a la vez
  draining = true;
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);
  const aiTriggers = new Map<string, string>();
  const historyTouched = new Set<string>();
  try {
    while (Date.now() < deadline) {
      const batch = await claimBatch(opts.batchSize ?? 10);
      if (batch.length === 0) break;
      for (const row of batch) {
        stats.processed++;
        try {
          const event = reviveEvent(row.normalized);
          const result = await processNormalizedEvent(row.object, event, {
            deferAi: (conversationId, triggerMessageId) => aiTriggers.set(conversationId, triggerMessageId),
          });
          if (result.outcome === "ignored" && result.reason === "unknown_message") {
            // El acuse llegó antes que su mensaje (el envío aún no guardó la
            // fila): se espera y se reintenta.
            if (row.attempts < STATUS_WAIT_ATTEMPTS) {
              await markRetry(row, "El mensaje de este acuse aún no está guardado");
              stats.retried++;
              continue;
            }
          }
          if (result.outcome === "stored") {
            stats.stored++;
            if (row.kind === "history") historyTouched.add(result.conversationId);
          }
          await markDone(
            row.id,
            result.outcome === "ignored" ? `ignored:${result.reason}` : result.outcome
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`[cola WhatsApp] falló el evento ${row.id} (intento ${row.attempts})`, e);
          await markRetry(row, message).catch(() => undefined);
          if (row.attempts >= MAX_ATTEMPTS) stats.dead++;
          else stats.retried++;
        }
      }
    }
  } finally {
    draining = false;
  }

  if (historyTouched.size > 0) {
    await finishHistorySync(historyTouched).catch((e) => console.warn("[cola WhatsApp] historial", e));
  }
  if (aiTriggers.size > 0) {
    const { runWhatsAppAi } = await import("@/lib/crm/whatsapp-agent/run");
    await Promise.allSettled(
      [...aiTriggers].map(([conversationId, triggerMessageId]) => runWhatsAppAi({ conversationId, triggerMessageId }))
    );
  }
  const recovered = await recoverStuck().catch(() => null);
  if (recovered && (recovered.approvals || recovered.queued || recovered.bulk)) {
    console.warn(`[cola WhatsApp] recuperado a medias: ${JSON.stringify(recovered)}`);
  }
  const media = await retryFailedMediaThrottled().catch(() => null);
  if (media && (media.fixed || media.failed || media.expired)) {
    console.info(`[cola WhatsApp] archivos reintentados: ${JSON.stringify(media)}`);
  }
  await pruneInbox().catch(() => undefined);
  return stats;
};

const SWEEP_KEY = "meta.inbox.sweepAt";

/**
 * Vacía la cola si hace más de 30 s que nadie lo hizo. La llaman el stream de
 * WhatsApp, la página Estado y el botón Reprocesar (el webhook vacía siempre).
 */
export const kickSweep = async (): Promise<DrainStats | null> => {
  const last = Number((await getSiteSetting(SWEEP_KEY)) ?? 0);
  if (Date.now() - last < 30_000) return null;
  await setSiteSetting(SWEEP_KEY, String(Date.now()));
  return drainInbox({ budgetMs: 45_000 });
};

/** Vuelve a poner en cola lo que falló o quedó muerto (botón Reprocesar). */
export const requeueFailed = async (): Promise<number> => {
  const { count } = await prisma.metaInboxEvent.updateMany({
    where: { state: { in: ["FAILED", "DEAD"] } },
    data: { state: "RECEIVED", nextAttemptAt: new Date(), attempts: 0, leaseUntil: null },
  });
  return count;
};

const PRUNE_KEY = "meta.inbox.prunedAt";

/**
 * Retención (una vez al día): el aviso crudo y los eventos procesados se
 * guardan 30 días; los muertos, 90 para poder revisarlos.
 */
export const pruneInbox = async (): Promise<void> => {
  const last = Number((await getSiteSetting(PRUNE_KEY)) ?? 0);
  if (Date.now() - last < 24 * 3600_000) return;
  await setSiteSetting(PRUNE_KEY, String(Date.now()));
  const days = (n: number) => new Date(Date.now() - n * 24 * 3600_000);
  await prisma.metaInboxEvent.deleteMany({ where: { state: "DONE", processedAt: { lt: days(30) } } });
  await prisma.metaInboxEvent.deleteMany({ where: { state: "DEAD", receivedAt: { lt: days(90) } } });
  await prisma.metaWebhookPayload.deleteMany({ where: { receivedAt: { lt: days(30) }, events: { none: {} } } });
  await prisma.metaWebhookEvent.deleteMany({ where: { processedAt: { lt: days(30) } } });
};
