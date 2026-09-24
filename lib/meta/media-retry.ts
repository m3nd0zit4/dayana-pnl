import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";
import type { NormalizedAttachment } from "./inbound";
import { rehostAttachment, type StoredAttachment } from "./media";
import { resolveWhatsAppCredentials } from "./whatsapp-provider";

/**
 * Archivos que no se pudieron bajar al llegar (WhatsApp caído un momento,
 * Blob con error…). WhatsApp guarda el archivo 7 días: se reintenta con espera
 * creciente hasta 6,5 días y, si no, queda «vencido».
 *
 * 360dialog bloquea los archivos una hora si fallan más de 5 pedidos en una
 * hora: aquí nunca se pasa de 4 fallos por hora.
 */

type RetryAttachment = StoredAttachment & { retries?: number; retryAt?: string };

export const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360, 1440];
const EXPIRE_AFTER_MS = 6.5 * 24 * 3600_000;
const FAIL_WINDOW_KEY = "whatsapp.mediaFailures";
const MAX_FAILS_PER_HOUR = 4;

/** ¿Hay que reintentar este adjunto ahora? (pura) */
export const needsRetry = (a: RetryAttachment, now = Date.now()): boolean =>
  !a.url &&
  Boolean(a.mediaId) &&
  a.unavailableReason !== "expired" &&
  (a.retries ?? 0) < RETRY_DELAYS_MIN.length &&
  (!a.retryAt || new Date(a.retryAt).getTime() <= now);

const recentFailures = async (): Promise<number[]> => {
  const raw = await getSiteSetting(FAIL_WINDOW_KEY);
  const list = raw ? (JSON.parse(raw) as number[]) : [];
  return list.filter((t) => Date.now() - t < 3600_000);
};

const recordFailure = async () => {
  const list = [...(await recentFailures()), Date.now()];
  await setSiteSetting(FAIL_WINDOW_KEY, JSON.stringify(list));
};

export const retryFailedMedia = async (opts: { limit?: number } = {}): Promise<{ fixed: number; failed: number; expired: number }> => {
  const stats = { fixed: 0, failed: 0, expired: 0 };
  if ((await recentFailures()).length >= MAX_FAILS_PER_HOUR) return stats;
  const credentials = await resolveWhatsAppCredentials();
  if (!credentials) return stats;

  const rows = await prisma.$queryRaw<{ id: string; attachments: unknown; sent_at: Date; body: string | null; updated_at: Date }[]>`
    SELECT id, attachments, sent_at, body, updated_at FROM conversation_messages
     WHERE sent_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - interval '7 days'
       AND jsonb_typeof(attachments) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(attachments) a
          WHERE a->>'url' IS NULL AND a->>'mediaId' IS NOT NULL
            AND COALESCE(a->>'unavailableReason', '') <> 'expired'
       )
     ORDER BY sent_at DESC
     LIMIT ${opts.limit ?? 10}`;

  for (const row of rows) {
    const items = row.attachments as RetryAttachment[];
    let changed = false;
    let transcript: string | undefined;
    const next: RetryAttachment[] = [];
    for (const a of items) {
      if (!needsRetry(a)) {
        next.push(a);
        continue;
      }
      if (Date.now() - new Date(row.sent_at).getTime() > EXPIRE_AFTER_MS) {
        next.push({ ...a, unavailableReason: "expired" });
        changed = true;
        stats.expired++;
        continue;
      }
      if ((await recentFailures()).length >= MAX_FAILS_PER_HOUR) {
        next.push(a);
        continue;
      }
      const stored = await rehostAttachment(
        {
          kind: a.kind as NormalizedAttachment["kind"],
          mediaId: a.mediaId,
          mimeType: a.mimeType ?? undefined,
          caption: a.caption ?? undefined,
        },
        credentials
      ).catch(() => null);
      changed = true;
      if (stored?.url) {
        next.push({ ...stored, caption: a.caption ?? stored.caption });
        if (stored.transcript) transcript = stored.transcript;
        stats.fixed++;
      } else {
        const retries = (a.retries ?? 0) + 1;
        const delay = RETRY_DELAYS_MIN[Math.min(retries, RETRY_DELAYS_MIN.length - 1)] * 60_000;
        next.push({
          ...a,
          unavailableReason: stored?.unavailableReason ?? a.unavailableReason ?? "download_failed",
          retries,
          retryAt: new Date(Date.now() + delay).toISOString(),
        });
        await recordFailure();
        stats.failed++;
      }
    }
    if (!changed) continue;
    // Escritura optimista: si el mensaje cambió mientras tanto, se deja para la próxima pasada.
    await prisma.conversationMessage.updateMany({
      where: { id: row.id, updatedAt: row.updated_at },
      data: {
        attachments: next as unknown as Prisma.InputJsonValue,
        ...(transcript && !row.body ? { body: `🎤 ${transcript}` } : {}),
      },
    });
  }
  return stats;
};

const THROTTLE_KEY = "whatsapp.mediaRetryAt";

/** Como mucho cada 2 minutos (lo llama el barrido de la cola). */
export const retryFailedMediaThrottled = async () => {
  const last = Number((await getSiteSetting(THROTTLE_KEY)) ?? 0);
  if (Date.now() - last < 120_000) return null;
  await setSiteSetting(THROTTLE_KEY, String(Date.now()));
  return retryFailedMedia();
};
