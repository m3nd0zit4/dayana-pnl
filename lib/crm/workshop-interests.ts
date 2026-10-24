import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { PROXIMO_WORKSHOP_SLUG } from "@/lib/workshops";

import { getSiteSetting, setSiteSetting } from "./site-settings";
import { isWorkshopAsk, titleWords, type OpenWorkshop } from "./whatsapp-agent/workshop-interest";

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
/** Cada pasada vuelve a mirar las últimas 2 h (un mensaje que llegó tarde); la fila no suma dos veces. */
const OVERLAP_MS = 2 * 3600_000;
/** Cuántos mensajes se leen por pasada (lo que quede, la próxima vez). */
const BATCH = 500;

/** «sanacion» → «sanaci[oóò]n»: el mensaje viene con tildes. */
const accentless = (word: string) =>
  word.replace(/[aeiou]/g, (v) => ({ a: "[aáà]", e: "[eéè]", i: "[iíì]", o: "[oóò]", u: "[uúü]" })[v as "a"]);

/** Lo que puede ser una pregunta por el taller: «taller», una palabra del título o el mes (lo decide `isWorkshopAsk`). */
const candidatePattern = (edition: OpenWorkshop) => {
  const month = edition.startsAt
    ? new Intl.DateTimeFormat("es-CO", { timeZone: edition.timezone, month: "long" }).format(edition.startsAt).toLowerCase()
    : null;
  return ["taller", "workshop", ...titleWords(edition.title), ...(month ? [month] : [])].map(accentless).join("|");
};

/** ¿Ya pagó esta edición? Quien pagó no es interesada (la IA no la invita a inscribirse). */
export const enrolledInWorkshop = async (contactId: string, editionId: string): Promise<boolean> =>
  (await prisma.enrollment.count({ where: { contactId, workshopEditionId: editionId, status: { in: ["ACTIVE", "COMPLETED"] } } })) > 0;

/**
 * Lee los mensajes nuevos de las personas que pueden hablar del taller y anota
 * a quien pregunta por él (también en dos mensajes seguidos: «para el 15 de
 * noviembre» + «El taller»). Idempotente: una fila por chat; si vuelve a
 * preguntar, sube `asks` y `last_asked_at`. El cursor avanza aunque no haya nada.
 */
export const syncWorkshopInterests = async (edition: OpenWorkshop & { createdAt: Date }): Promise<{ scanned: number; changed: number }> => {
  const startedAt = new Date();
  const raw = await getSiteSetting(cursorKey(edition.id)).catch(() => null);
  const since = raw ? new Date(new Date(raw).getTime() - OVERLAP_MS) : new Date(edition.createdAt.getTime() - ANNOUNCED_BEFORE_MS);
  const rows = await prisma.$queryRaw<{ conversation_id: string; body: string; sent_at: Date; prev_body: string | null }[]>`
    SELECT m.conversation_id, m.body, m.sent_at,
           (SELECT p.body FROM conversation_messages p
             WHERE p.conversation_id = m.conversation_id AND p.direction = 'INBOUND'
               AND p.sent_at < m.sent_at AND p.sent_at > m.sent_at - INTERVAL '10 minutes'
             ORDER BY p.sent_at DESC LIMIT 1) AS prev_body
    FROM conversation_messages m
    WHERE m.direction = 'INBOUND'
      AND m.sent_at > ${since}
      AND m.body IS NOT NULL
      AND m.body ~* ${candidatePattern(edition)}
    ORDER BY m.sent_at ASC
    LIMIT ${BATCH}`;
  let changed = 0;
  for (const r of rows) {
    if (!isWorkshopAsk(r.body, edition) && !(r.prev_body && isWorkshopAsk(`${r.prev_body}\n${r.body}`, edition))) continue;
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
  // Lote lleno: hasta el último leído (el resto, la próxima vez). Si no, hasta ahora.
  const next = rows.length >= BATCH ? rows.at(-1)!.sent_at : startedAt;
  await setSiteSetting(cursorKey(edition.id), next.toISOString()).catch(() => undefined);
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
