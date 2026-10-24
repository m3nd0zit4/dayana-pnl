import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";

import { getSiteSetting, setSiteSetting } from "./site-settings";
import { isWorkshopAsk, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";

/**
 * Las interesadas en un taller (dueña, 24-oct: «en la sección de taller, una
 * lista de las personas que preguntaron por el taller especificamente para
 * hacerles un seguimiento especial»). Las filas salen de leer los mensajes de
 * WhatsApp (`isWorkshopAsk`), así que también entran quienes preguntaron antes
 * de que el taller existiera en el CRM (Dayana lo anunció y lo creó media hora
 * después). La tabla va por SQL: el cliente de Prisma no se regenera en local
 * (lo comparten las copias de trabajo).
 */

export const INTEREST_STATUSES = ["nuevo", "contactada", "inscrita", "descartada"] as const;
export type InterestStatus = (typeof INTEREST_STATUSES)[number];
export const isInterestStatus = (v: unknown): v is InterestStatus => INTEREST_STATUSES.includes(v as InterestStatus);

const workshopSelect = {
  id: true,
  title: true,
  slug: true,
  startsAt: true,
  startsAtHasTime: true,
  timezone: true,
  dateLabel: true,
  scheduleLabel: true,
  cardSummary: true,
} as const;

/** El taller con inscripciones abiertas que todavía no pasó (el más próximo). Para la IA. */
export const openWorkshopForAi = async (now = new Date()): Promise<OpenWorkshop | null> =>
  prisma.workshopEdition.findFirst({
    where: {
      status: "OPEN",
      endedAt: null,
      slug: { not: PROXIMO_WORKSHOP_SLUG },
      OR: [{ startsAt: null }, { startsAt: { gte: new Date(now.getTime() - 24 * 3600_000) } }],
    },
    orderBy: { startsAt: "asc" },
    select: workshopSelect,
  });

/** Hasta dónde se leyeron los mensajes para esta edición. */
const cursorKey = (editionId: string) => `workshop.interests.cursor.${editionId}`;
/** Dayana anuncia antes de crear el taller: se lee desde 3 días antes de crearlo. */
const ANNOUNCED_BEFORE_MS = 3 * 24 * 3600_000;
/** Cuántos mensajes con «taller» se leen por pasada (lo que quede, la próxima vez). */
const BATCH = 500;

/**
 * Lee los mensajes nuevos de las personas que mencionan el taller y anota a
 * quien pregunta por él. Idempotente: una fila por chat; si vuelve a
 * preguntar, sube `asks` y `last_asked_at`. Avanza el cursor hasta el último
 * mensaje leído.
 */
export const syncWorkshopInterests = async (edition: OpenWorkshop & { createdAt: Date }): Promise<{ scanned: number; changed: number }> => {
  const raw = await getSiteSetting(cursorKey(edition.id)).catch(() => null);
  const since = raw ? new Date(raw) : new Date(edition.createdAt.getTime() - ANNOUNCED_BEFORE_MS);
  const rows = await prisma.$queryRaw<{ conversation_id: string; body: string; sent_at: Date }[]>`
    SELECT m.conversation_id, m.body, m.sent_at
    FROM conversation_messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.direction = 'INBOUND'
      AND m.sent_at > ${since}
      AND m.body IS NOT NULL
      AND (m.body ILIKE '%taller%' OR m.body ILIKE '%workshop%')
    ORDER BY m.sent_at ASC
    LIMIT ${BATCH}`;
  let changed = 0;
  for (const r of rows) {
    if (!isWorkshopAsk(r.body, edition)) continue;
    // Un mensaje ya contado (el mismo instante) no suma otra vez.
    changed += await prisma.$executeRaw`
      INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, updated_at)
      VALUES (${randomUUID()}, ${edition.id}, ${r.conversation_id}, ${r.body.slice(0, 500)}, ${r.sent_at}, ${r.sent_at}, 1, 'nuevo', NOW())
      ON CONFLICT (edition_id, conversation_id) DO UPDATE
        SET asks = workshop_interests.asks + 1,
            last_asked_at = EXCLUDED.last_asked_at,
            updated_at = NOW()
        WHERE EXCLUDED.last_asked_at > workshop_interests.last_asked_at`;
  }
  const last = rows.at(-1)?.sent_at;
  if (last) await setSiteSetting(cursorKey(edition.id), last.toISOString()).catch(() => undefined);
  return { scanned: rows.length, changed };
};

export type WorkshopInterestRow = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string;
  firstMessage: string;
  firstAskedAt: Date;
  lastAskedAt: Date;
  asks: number;
  status: InterestStatus;
  /** Su próxima llamada o sesión en la agenda, si tiene. */
  nextCallAt: Date | null;
  /** Pagó este taller. */
  paid: boolean;
};

/** Las interesadas de la edición, la más reciente primero, con su próxima llamada y si ya pagó. */
export const listWorkshopInterests = async (editionId: string): Promise<WorkshopInterestRow[]> => {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      conversation_id: string;
      name: string | null;
      phone: string;
      first_message: string;
      first_asked_at: Date;
      last_asked_at: Date;
      asks: number;
      status: string;
      next_call_at: Date | null;
      paid: boolean;
    }[]
  >`
    SELECT i.id, i.conversation_id,
           COALESCE(NULLIF(TRIM(CONCAT(ct.first_name, ' ', ct.last_name)), ''), c.participant_name) AS name,
           c.external_thread_id AS phone,
           i.first_message, i.first_asked_at, i.last_asked_at, i.asks, i.status,
           (SELECT MIN(a.starts_at) FROM calendar_appointments a
             WHERE a.conversation_id = c.id AND a.status = 'active' AND a.starts_at > NOW() - INTERVAL '1 hour') AS next_call_at,
           EXISTS (SELECT 1 FROM enrollments e
             WHERE e.workshop_edition_id = i.edition_id AND e.contact_id = c.contact_id
               AND e.status IN ('ACTIVE', 'COMPLETED')) AS paid
    FROM workshop_interests i
    JOIN conversations c ON c.id = i.conversation_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE i.edition_id = ${editionId}
    ORDER BY i.last_asked_at DESC
    LIMIT 300`;
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    name: r.name,
    phone: r.phone,
    firstMessage: r.first_message,
    firstAskedAt: r.first_asked_at,
    lastAskedAt: r.last_asked_at,
    asks: r.asks,
    status: isInterestStatus(r.status) ? r.status : "nuevo",
    nextCallAt: r.next_call_at,
    paid: r.paid,
  }));
};

/** Dayana marca el seguimiento. Devuelve false si la fila no es de esa edición. */
export const setWorkshopInterestStatus = async (editionId: string, id: string, status: InterestStatus): Promise<boolean> => {
  const n = await prisma.$executeRaw`
    UPDATE workshop_interests SET status = ${status}, updated_at = NOW()
    WHERE id = ${id} AND edition_id = ${editionId}`;
  return n > 0;
};
