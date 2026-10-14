import { del, list } from "@vercel/blob";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig } from "../whatsapp-ai-config";
import { cleanableAttachment, cleanedAttachment, type CleanupAttachment } from "./media-cleanup-rules";

/**
 * Limpieza de fotos, audios y videos viejos que llegaron por los chats.
 *
 * El store de Blob se llenó y quedó suspendido (2026-09-30): cada foto y cada
 * audio que llega se guarda ahí para siempre. Pasados `mediaCleanup.keepDays`
 * se borra el archivo del store y el mensaje queda en el chat con «se borró en
 * la limpieza»; la transcripción del audio se queda (la IA y la búsqueda leen
 * el texto, no el archivo). Qué se puede borrar lo decide
 * `media-cleanup-rules.ts`: nunca comprobantes de pago, stickers, documentos
 * ni lo que manda Dayana, ni un audio que aún no tiene texto.
 *
 * Lo usan el reloj (paso «limpieza», solo con `mediaCleanup.enabled`) y
 * `scripts/whatsapp-media-cleanup.ts` (prueba en seco por defecto).
 */

export type MediaCleanupResult = {
  dryRun: boolean;
  keepDays: number;
  /** Mensajes revisados con algo que se puede borrar. */
  messages: number;
  /** Archivos que se borraron (o se borrarían, en seco). */
  files: number;
  /** Por tipo: { image: 120, audio: 80, video: 3 }. */
  byKind: Record<string, number>;
  /** Si Blob rechazó el borrado (p. ej. el store suspendido), por qué. */
  error?: string;
};

type Row = { id: string; body: string | null; attachments: unknown };

export const cleanOldMedia = async (opts: {
  budgetMs: number;
  dryRun?: boolean;
  /** Si no viene, el de Ajustes. */
  keepDays?: number;
  /** Mensajes por tanda. */
  batch?: number;
  now?: Date;
}): Promise<MediaCleanupResult> => {
  const keepDays = opts.keepDays ?? (await getWhatsAppAiConfig()).mediaCleanup.keepDays;
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - keepDays * 24 * 3600_000);
  const deadline = Date.now() + opts.budgetMs;
  const batch = opts.batch ?? 100;
  const result: MediaCleanupResult = { dryRun, keepDays, messages: 0, files: 0, byKind: {} };
  // En seco no se escribe nada, así que se avanza por fecha en vez de releer lo mismo.
  let after: { sentAt: Date; id: string } | null = null;

  while (Date.now() < deadline) {
    const cursor: Prisma.Sql = after
      ? Prisma.sql`AND (m.sent_at, m.id) > (${after.sentAt}, ${after.id})`
      : Prisma.empty;
    const rows = await prisma.$queryRaw<(Row & { sent_at: Date })[]>`
      SELECT m.id, m.body, m.attachments, m.sent_at
        FROM conversation_messages m
       WHERE m.direction = 'INBOUND'
         AND m.sent_at < ${cutoff}
         AND jsonb_typeof(m.attachments) = 'array'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(m.attachments) a
            WHERE a->>'kind' IN ('image', 'audio', 'video')
              AND a->>'url' LIKE 'https://%.blob.vercel-storage.com/inbox/%'
         )
         AND NOT EXISTS (SELECT 1 FROM whatsapp_payment_receipts r WHERE r.message_id = m.id)
         ${cursor}
       ORDER BY m.sent_at, m.id
       LIMIT ${batch}`;
    if (rows.length === 0) break;
    const last = rows[rows.length - 1];
    after = { sentAt: last.sent_at, id: last.id };

    const work = rows
      .map((row) => {
        const list = Array.isArray(row.attachments) ? (row.attachments as CleanupAttachment[]) : [];
        const hasText = Boolean(row.body?.trim());
        const urls = list.filter((a) => cleanableAttachment(a, { hasText })).map((a) => a.url as string);
        return { row, list, hasText, urls };
      })
      .filter((w) => w.urls.length > 0);
    if (work.length === 0) continue;

    if (!dryRun) {
      try {
        await del(work.flatMap((w) => w.urls));
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    for (const w of work) {
      result.messages++;
      for (const a of w.list) {
        if (!cleanableAttachment(a, { hasText: w.hasText })) continue;
        result.files++;
        result.byKind[a.kind ?? "otro"] = (result.byKind[a.kind ?? "otro"] ?? 0) + 1;
      }
      if (dryRun) continue;
      const next = w.list.map((a) => (cleanableAttachment(a, { hasText: w.hasText }) ? cleanedAttachment(a, now) : a));
      await prisma.conversationMessage.update({
        where: { id: w.row.id },
        data: { attachments: next as unknown as Prisma.InputJsonValue },
      });
    }
  }
  return result;
};

/**
 * Las partes de un historial subido (`inbox/history/<id>/part-*`): se juntan
 * al procesarlo y después no sirven. Antes se quedaban para siempre. Se borran
 * las de más de un día (una subida en curso nunca tarda tanto).
 */
export const cleanHistoryParts = async (opts: { dryRun?: boolean; now?: Date }): Promise<{ files: number; bytes: number; error?: string }> => {
  const cutoff = (opts.now ?? new Date()).getTime() - 24 * 3600_000;
  const out = { files: 0, bytes: 0 } as { files: number; bytes: number; error?: string };
  let cursor: string | undefined;
  try {
    do {
      const page = await list({ prefix: "inbox/history/", limit: 1000, cursor });
      const old = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
      if (old.length > 0 && !opts.dryRun) await del(old.map((b) => b.url));
      out.files += old.length;
      out.bytes += old.reduce((n, b) => n + b.size, 0);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
};

/** Cuánto ocupa cada carpeta del store (para saber qué lo llena). Solo lee. */
export const blobUsageByFolder = async (): Promise<Record<string, { files: number; mb: number }>> => {
  const usage: Record<string, { files: number; bytes: number }> = {};
  let cursor: string | undefined;
  do {
    const page = await list({ limit: 1000, cursor });
    for (const b of page.blobs) {
      const parts = b.pathname.split("/");
      const folder = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.length > 1 ? parts[0] : "(raíz)";
      usage[folder] ??= { files: 0, bytes: 0 };
      usage[folder].files++;
      usage[folder].bytes += b.size;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return Object.fromEntries(
    Object.entries(usage)
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([k, v]) => [k, { files: v.files, mb: Math.round((v.bytes / 1e6) * 10) / 10 }])
  );
};
