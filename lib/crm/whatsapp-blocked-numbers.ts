import { createHmac } from "node:crypto";

import { prisma } from "@/lib/db";
import { graphGet, graphPost, MetaApiError } from "@/lib/meta/client";
import { resolveWhatsAppCredentials } from "@/lib/meta/whatsapp-provider";
import { contactPhoneCandidates, isWhatsAppUserId, whatsAppIdVariants } from "@/lib/whatsapp-contact";

import { phoneHash } from "./whatsapp-ignored-numbers";

/**
 * Números bloqueados en WhatsApp (owner, 8-nov: «los números que bloquea
 * Dayana directamente desde WhatsApp se desaparezcan también del CRM»).
 *
 * Un número bloqueado:
 * - sale de todas las listas del CRM (`conversations.blocked_at`,
 *   `contacts.blocked_at`; el chat y el contacto se ocultan, no se borran:
 *   desbloquearlo los devuelve, y un contacto con pagos o inscripciones nunca
 *   pierde su historial de dinero);
 * - no entra más al CRM (`ingest.ts` ignora sus mensajes, la importación del
 *   celular también), la IA no le contesta y nada le sale (`send.ts` y el
 *   envío de notificaciones se niegan: ni texto, ni plantillas, ni reacciones).
 *
 * Igual que los números personales, se guarda solo una huella (HMAC) del
 * número (`phoneHash`, la misma para sus formas 52/521, 54/549, Brasil con y
 * sin 9). La fila queda al desbloquear (`unblockedAt`): es el registro mínimo
 * de qué pasó y cuándo, sin mensajes ni archivos.
 *
 * De dónde sale el bloqueo:
 * - `app`: Dayana lo bloqueó en su WhatsApp Business. Meta NO avisa por webhook
 *   (ni `smb_app_state_sync` ni ningún otro campo trae bloqueos), así que el
 *   reloj (`tick.ts`) lee la lista de bloqueados (`GET /block_users`) cada
 *   ≥ 30 min y la compara (`syncBlockList`).
 * - `sexual_content`: lo bloquea el código (`whatsapp-agent/sexual-content.ts`).
 * - `manual`: «Bloquear número» desde el CRM.
 */

const key = (): string | null => process.env.WHATSAPP_IGNORE_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || null;

/** Huella del chat: la del número (todas sus formas) o, para un id de usuario (BSUID), la del id. */
export const blockHash = (threadId: string): string | null => {
  const id = threadId.trim();
  if (!isWhatsAppUserId(id)) return phoneHash(id);
  const secret = key();
  return secret ? createHmac("sha256", secret).update(`wa-user:${id}`).digest("hex") : null;
};

export type BlockReason = "app" | "sexual_content" | "manual";
export type BlockSource = "sync" | "auto" | "staff";

/**
 * ¿Está bloqueado ahora alguno de estos ids (el número y su id de usuario)?
 * Para recibir y contestar, un fallo de la base cuenta como no (nunca deja a
 * alguien sin respuesta por un error); para ENVIAR (`strict`) lanza: un error
 * no puede dejar salir un mensaje a un número bloqueado (revisión 8-nov).
 */
export const isBlockedAny = async (ids: (string | null | undefined)[], opts: { strict?: boolean } = {}): Promise<boolean> => {
  const hashes = [...new Set(ids.map((id) => (id ? blockHash(id) : null)).filter((h): h is string => Boolean(h)))];
  if (hashes.length === 0) return false;
  const query = prisma.whatsAppBlockedNumber.count({ where: { phoneHash: { in: hashes }, unblockedAt: null } });
  return (opts.strict ? await query : await query.catch(() => 0)) > 0;
};

export const isBlockedNumber = async (threadId: string, opts: { strict?: boolean } = {}): Promise<boolean> =>
  isBlockedAny([threadId], opts);

/** Lo mismo para un teléfono E.164 (`+57…`) al enviar notificaciones: lanza si no se pudo mirar. */
export const isBlockedPhone = async (phoneE164: string): Promise<boolean> =>
  isBlockedNumber(phoneE164.replace(/\D/g, ""), { strict: true });

/** Los chats de WhatsApp de ese número, en cualquiera de sus formas. */
const chatsOf = async (threadId: string): Promise<{ id: string; contactId: string | null }[]> =>
  prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: whatsAppIdVariants(threadId) } },
    select: { id: true, contactId: true },
  });

/**
 * Oculta (o vuelve a mostrar con `at = null`) los chats y contactos del número.
 * Los contactos, solo por su teléfono: un chat ligado a mano al contacto de
 * otra persona no la oculta a ella (revisión 8-nov). Devuelve cuántos tocó.
 */
export const setNumberHidden = async (
  threadId: string,
  at: Date | null
): Promise<{ chats: number; contacts: number }> => {
  const chats = await chatsOf(threadId);
  const contactIds = new Set<string>();
  const phones = contactPhoneCandidates(threadId);
  if (phones.length) {
    const byPhone = await prisma.contact.findMany({ where: { phoneE164: { in: phones } }, select: { id: true } });
    for (const c of byPhone) contactIds.add(c.id);
  }
  const [c1, c2] = await Promise.all([
    chats.length
      ? prisma.conversation.updateMany({ where: { id: { in: chats.map((c) => c.id) } }, data: { blockedAt: at } })
      : Promise.resolve({ count: 0 }),
    contactIds.size
      ? prisma.contact.updateMany({ where: { id: { in: [...contactIds] } }, data: { blockedAt: at } })
      : Promise.resolve({ count: 0 }),
  ]);
  return { chats: c1.count, contacts: c2.count };
};

/**
 * Anota el bloqueo. `created` = este llamado lo bloqueó (no estaba bloqueado):
 * es el reclamo, dos procesos a la vez no hacen dos veces lo mismo.
 */
export const recordBlock = async (input: {
  threadId: string;
  reason: BlockReason;
  source: BlockSource;
  detail?: string | null;
  apiBlockedAt?: Date | null;
}): Promise<{ hash: string; created: boolean; reason: string; since: Date } | null> => {
  const hash = blockHash(input.threadId);
  if (!hash) return null;
  const data = {
    reason: input.reason,
    source: input.source,
    detail: input.detail?.slice(0, 200) ?? null,
    apiBlockedAt: input.apiBlockedAt ?? null,
    apiError: null,
    actions: undefined,
  };
  const existing = await prisma.whatsAppBlockedNumber.findUnique({
    where: { phoneHash: hash },
    select: { reason: true, unblockedAt: true, blockedAt: true },
  });
  if (existing && !existing.unblockedAt) return { hash, created: false, reason: existing.reason, since: existing.blockedAt };
  try {
    // Sin fila: se crea (si otro proceso la creó en el mismo instante, cae abajo).
    if (!existing) {
      await prisma.whatsAppBlockedNumber.create({ data: { phoneHash: hash, ...data } });
      return { hash, created: true, reason: input.reason, since: new Date() };
    }
    throw new Error("reopen");
  } catch {
    // Ya hay fila: si estaba desbloqueado, se vuelve a bloquear (otro motivo, otra fecha).
    const reopened = await prisma.whatsAppBlockedNumber.updateMany({
      where: { phoneHash: hash, unblockedAt: { not: null } },
      data: { ...data, blockedAt: new Date(), unblockedAt: null },
    });
    if (reopened.count > 0) return { hash, created: true, reason: input.reason, since: new Date() };
    const row = await prisma.whatsAppBlockedNumber.findUnique({ where: { phoneHash: hash }, select: { reason: true, blockedAt: true } });
    return { hash, created: false, reason: row?.reason ?? input.reason, since: row?.blockedAt ?? new Date() };
  }
};

/** Lo que se hizo (conteos), sobre la fila. */
export const noteBlockActions = async (hash: string, patch: Record<string, unknown>, api?: { at?: Date | null; error?: string | null }) => {
  const row = await prisma.whatsAppBlockedNumber.findUnique({ where: { phoneHash: hash }, select: { actions: true } });
  const prev = row?.actions && typeof row.actions === "object" && !Array.isArray(row.actions) ? (row.actions as Record<string, unknown>) : {};
  await prisma.whatsAppBlockedNumber.update({
    where: { phoneHash: hash },
    data: {
      actions: { ...prev, ...patch } as object,
      ...(api?.at !== undefined ? { apiBlockedAt: api.at } : {}),
      ...(api?.error !== undefined ? { apiError: api.error?.slice(0, 300) ?? null } : {}),
    },
  });
};

type BlockApiResult = {
  block_users?: {
    added_users?: { input?: string; wa_id?: string }[];
    failed_users?: { input?: string; errors?: { message?: string; code?: number }[] }[];
  };
};

/**
 * Bloquea el número en WhatsApp por la API (`POST /block_users`; en 360dialog
 * sin id de teléfono). Meta solo deja bloquear a quien escribió en las últimas
 * 24 h (error 131047). Nunca lanza.
 */
export const blockOnWhatsApp = async (threadId: string): Promise<{ ok: boolean; error: string | null }> => {
  const credentials = await resolveWhatsAppCredentials().catch(() => null);
  if (!credentials) return { ok: false, error: "whatsapp_not_configured" };
  const id = threadId.trim();
  const user = isWhatsAppUserId(id) ? { user_id: id } : { user: id.replace(/\D/g, "") };
  try {
    const res = await graphPost<BlockApiResult>(
      `${credentials.accountId}/block_users`,
      { messaging_product: "whatsapp", block_users: [user] },
      credentials
    );
    const failed = res.block_users?.failed_users?.[0];
    if (failed) {
      const err = failed.errors?.[0];
      return { ok: false, error: `${err?.code ?? "?"}: ${err?.message ?? "failed"}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    if (e instanceof MetaApiError) return { ok: false, error: `${e.code ?? e.status}: ${e.message}`.slice(0, 300) };
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
};

type BlockListPage = {
  data?: ({ wa_id?: string; user_id?: string; block_users?: { wa_id?: string; user_id?: string }[] })[];
  paging?: { cursors?: { after?: string }; next?: string };
};

/**
 * Los ids (wa_id o BSUID) de la lista de bloqueados de WhatsApp. Acepta la
 * forma de Meta (`data[].wa_id`) y la que documenta 360dialog
 * (`data[].block_users[].wa_id`). Lanza si no se pudo leer: quien llama no
 * debe desbloquear a nadie por una lista que no leyó.
 */
export const fetchBlockList = async (maxPages = 20): Promise<string[]> => {
  const credentials = await resolveWhatsAppCredentials();
  if (!credentials) throw new Error("whatsapp_not_configured");
  const out: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await graphGet<BlockListPage>(
      `${credentials.accountId}/block_users`,
      { limit: "200", ...(after ? { after } : {}) },
      credentials
    );
    for (const row of res.data ?? []) {
      const items = Array.isArray(row.block_users) ? row.block_users : [row];
      for (const u of items) {
        const id = u.wa_id ?? u.user_id;
        if (id) out.push(String(id));
      }
    }
    const next = res.paging?.cursors?.after;
    if (!next || next === after || (res.data ?? []).length === 0) return out;
    after = next;
  }
  // Una lista cortada se leería como «desbloqueó a los que faltan».
  throw new Error("block_list_truncated");
};

export type BlockSyncResult = {
  listed: number;
  added: number;
  removed: number;
  hiddenChats: number;
  shownChats: number;
  skippedUnblock?: string;
};

/** Qué cambia, sin tocar la base (puro, para las pruebas). */
export const planBlockSync = (input: {
  listedHashes: Set<string>;
  /** Filas bloqueadas ahora: huella, motivo y si ya se vio en la lista de WhatsApp (`apiBlockedAt`). */
  current: { phoneHash: string; reason: string; apiBlockedAt: Date | null }[];
}): { add: string[]; remove: string[] } => {
  const current = new Map(input.current.map((r) => [r.phoneHash, r]));
  const add = [...input.listedHashes].filter((h) => !current.has(h));
  // Solo se desbloquea lo que la lista tenía: lo que vino de la app, o uno
  // bloqueado desde el CRM que ya se vio en la lista y ya no está (Dayana lo
  // desbloqueó en su celular). Un bloqueo por contenido sexual nunca se suelta
  // solo (revisión 8-nov), ni uno que nunca se vio en la lista.
  const remove = input.current
    .filter(
      (r) =>
        !input.listedHashes.has(r.phoneHash) &&
        (r.reason === "app" || (r.reason === "manual" && r.apiBlockedAt !== null))
    )
    .map((r) => r.phoneHash);
  return { add, remove };
};

/**
 * Lee la lista de bloqueados de WhatsApp y la aplica: los nuevos se ocultan
 * del CRM, los que Dayana desbloqueó vuelven. Sin el número no se puede
 * buscar un chat por su huella, así que para desbloquear se miran los chats y
 * contactos ocultos y se compara su huella.
 */
export const syncBlockList = async (deps: { list?: () => Promise<string[]>; now?: Date } = {}): Promise<BlockSyncResult> => {
  const now = deps.now ?? new Date();
  const ids = await (deps.list ?? (() => fetchBlockList()))();
  const byHash = new Map<string, string>();
  for (const id of ids) {
    const h = blockHash(id);
    if (h) byHash.set(h, id);
  }
  const current = await prisma.whatsAppBlockedNumber.findMany({
    where: { unblockedAt: null },
    select: { phoneHash: true, reason: true, apiBlockedAt: true },
  });
  const plan = planBlockSync({ listedHashes: new Set(byHash.keys()), current });
  const result: BlockSyncResult = { listed: byHash.size, added: 0, removed: 0, hiddenChats: 0, shownChats: 0 };

  for (const hash of plan.add) {
    const id = byHash.get(hash)!;
    const r = await recordBlock({ threadId: id, reason: "app", source: "sync", apiBlockedAt: now });
    if (!r?.created) continue;
    const hidden = await setNumberHidden(id, now);
    result.added++;
    result.hiddenChats += hidden.chats;
    await noteBlockActions(hash, { hiddenChats: hidden.chats, hiddenContacts: hidden.contacts });
  }
  // Lo que bloqueamos nosotros y sí está en la lista: queda marcado como de la API.
  // `apiBlockedAt` = visto en la lista de WhatsApp (que el POST lo aceptara va en `actions.apiAccepted`).
  const listedOurs = current.filter((r) => byHash.has(r.phoneHash) && r.apiBlockedAt === null).map((r) => r.phoneHash);
  if (listedOurs.length) {
    await prisma.whatsAppBlockedNumber.updateMany({ where: { phoneHash: { in: listedOurs } }, data: { apiBlockedAt: now } });
  }

  // Una lista vacía suele ser un fallo de lectura, no que Dayana desbloqueó a todos.
  if (byHash.size === 0 && plan.remove.length > 1) {
    result.skippedUnblock = "empty_list";
    return result;
  }
  if (plan.remove.length) {
    const removeSet = new Set(plan.remove);
    await prisma.whatsAppBlockedNumber.updateMany({ where: { phoneHash: { in: plan.remove } }, data: { unblockedAt: now } });
    result.removed = plan.remove.length;
    const hiddenChats = await prisma.conversation.findMany({
      where: { channel: "WHATSAPP", blockedAt: { not: null } },
      select: { id: true, externalThreadId: true },
    });
    const show = hiddenChats.filter((c) => removeSet.has(blockHash(c.externalThreadId) ?? ""));
    if (show.length) {
      const r = await prisma.conversation.updateMany({ where: { id: { in: show.map((c) => c.id) } }, data: { blockedAt: null } });
      result.shownChats = r.count;
    }
    const hiddenContacts = await prisma.contact.findMany({ where: { blockedAt: { not: null } }, select: { id: true, phoneE164: true } });
    const showContacts = hiddenContacts.filter((c) => removeSet.has(blockHash(c.phoneE164.replace(/\D/g, "")) ?? ""));
    if (showContacts.length) {
      await prisma.contact.updateMany({ where: { id: { in: showContacts.map((c) => c.id) } }, data: { blockedAt: null } });
    }
  }
  return result;
};

/** Lo que el CRM muestra de la lista (sin números: solo huellas cortas, motivos y fechas). */
export const listBlockedNumbers = async () =>
  prisma.whatsAppBlockedNumber.findMany({
    orderBy: { blockedAt: "desc" },
    take: 200,
    select: { phoneHash: true, reason: true, source: true, detail: true, apiBlockedAt: true, apiError: true, actions: true, blockedAt: true, unblockedAt: true },
  });
