import type {
  NotificationEventType,
  NotificationSeverity,
  Prisma,
} from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { NOTIFICATION_CATALOG } from "./catalog";
import {
  PLATFORM_BROADCAST_CHUNK,
  PLATFORM_BROADCAST_MAX,
} from "./types";

export type EmitInput = {
  eventType: NotificationEventType;
  title: string;
  /** Sobrescribe la severidad por defecto del catálogo. */
  severity?: NotificationSeverity;
  body?: string | null;
  /** Ruta interna, p. ej. `/admin/contacts/abc`. */
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  /**
   * Destinatarios de staff. `"ALL"` resuelve por catálogo + preferencias;
   * una lista de ids omite la resolución (úsala solo cuando ya filtraste).
   * Omitir = sin destinatarios de staff.
   */
  staff?: "ALL" | string[];
  /** Contactos destinatarios (miembros del portal). */
  contactIds?: string[];
};

const coalesceWindowStart = (eventType: NotificationEventType): Date | null => {
  const seconds = NOTIFICATION_CATALOG[eventType].coalesceWindowSec;
  if (!seconds) return null;
  return new Date(Date.now() - seconds * 1000);
};

/**
 * Busca una notificación reciente y sin leer del mismo evento y entidad. Si la
 * encuentra, incrementa el contador en vez de insertar una fila nueva — es lo
 * que impide que un ataque de fuerza bruta genere 400 elementos en la campana.
 */
const tryCoalesce = async (input: EmitInput): Promise<string | null> => {
  const since = coalesceWindowStart(input.eventType);
  if (!since) return null;

  const existing = await prisma.platformNotification.findFirst({
    where: {
      eventType: input.eventType,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdAt: { gte: since },
      recipients: { some: { readAt: null, dismissedAt: null } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, metadata: true, title: true },
  });
  if (!existing) return null;

  const previous =
    existing.metadata && typeof existing.metadata === "object" &&
    !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};
  const count =
    typeof previous.count === "number" && Number.isFinite(previous.count)
      ? previous.count + 1
      : 2;

  await prisma.platformNotification.update({
    where: { id: existing.id },
    data: {
      // `createdAt` se refresca para que la agrupación suba al tope del feed.
      createdAt: new Date(),
      title: input.title,
      body: input.body ?? null,
      metadata: { ...previous, count } as Prisma.InputJsonValue,
      recipients: { updateMany: { where: {}, data: { readAt: null } } },
    },
  });

  return existing.id;
};

const resolveStaffTargets = async (
  input: EmitInput
): Promise<string[]> => {
  if (!input.staff) return [];
  if (Array.isArray(input.staff)) return input.staff;

  // Import diferido: preferences.ts consulta Prisma y solo hace falta en el
  // camino "ALL".
  const { staffRecipientsFor } = await import("./preferences");
  const recipients = await staffRecipientsFor(input.eventType);
  return recipients.map((recipient) => recipient.staffUserId);
};

const resolveContactTargets = async (
  input: EmitInput
): Promise<string[]> => {
  const ids = input.contactIds ?? [];
  if (ids.length === 0) return [];

  // Respeta el interruptor del portal del miembro.
  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids }, notifyInApp: true },
    select: { id: true },
  });
  return contacts.map((contact) => contact.id);
};

/**
 * Registra un evento de la plataforma y lo reparte a sus destinatarios.
 *
 * Toma destinatarios explícitos a propósito. Para enviar a una audiencia
 * completa usa `broadcastPlatformNotification`, que impone un tope y hace los
 * insertos por lotes — así el modo de fallo "10.000 filas en el camino de una
 * petición" no existe.
 */
export const emitPlatformNotification = async (
  input: EmitInput
): Promise<string | null> => {
  const entry = NOTIFICATION_CATALOG[input.eventType];

  if (entry.audience === "STAFF" && (input.contactIds?.length ?? 0) > 0) {
    throw new Error(
      `El evento ${input.eventType} es solo para staff; no acepta contactIds.`
    );
  }
  if (entry.audience === "MEMBER" && input.staff) {
    throw new Error(
      `El evento ${input.eventType} es solo para miembros; no acepta destinatarios de staff.`
    );
  }

  const [staffIds, contactIds] = await Promise.all([
    resolveStaffTargets(input),
    resolveContactTargets(input),
  ]);

  if (staffIds.length === 0 && contactIds.length === 0) return null;

  const coalescedId = await tryCoalesce(input);
  if (coalescedId) return coalescedId;

  const notification = await prisma.platformNotification.create({
    data: {
      eventType: input.eventType,
      severity: input.severity ?? entry.defaultSeverity,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      recipients: {
        create: [
          ...staffIds.map((staffUserId) => ({ staffUserId })),
          ...contactIds.map((contactId) => ({ contactId })),
        ],
      },
    },
    select: { id: true },
  });

  scheduleNotificationEmails(notification.id);
  return notification.id;
};

/**
 * Envía un evento a muchos contactos (p. ej. "se publicó una grabación").
 * Rechaza audiencias absurdas y hace los insertos por lotes.
 */
export const broadcastPlatformNotification = async (
  input: Omit<EmitInput, "contactIds" | "staff"> & { contactIds: string[] }
): Promise<string | null> => {
  const entry = NOTIFICATION_CATALOG[input.eventType];
  if (entry.audience === "STAFF") {
    throw new Error(
      `El evento ${input.eventType} es solo para staff; no se puede difundir a contactos.`
    );
  }

  const targets = await prisma.contact.findMany({
    where: { id: { in: input.contactIds }, notifyInApp: true },
    select: { id: true },
  });
  if (targets.length === 0) return null;
  if (targets.length > PLATFORM_BROADCAST_MAX) {
    throw new Error(
      `Difusión de ${targets.length} destinatarios supera el tope de ${PLATFORM_BROADCAST_MAX}.`
    );
  }

  const notification = await prisma.platformNotification.create({
    data: {
      eventType: input.eventType,
      severity: input.severity ?? entry.defaultSeverity,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
    },
    select: { id: true },
  });

  for (let i = 0; i < targets.length; i += PLATFORM_BROADCAST_CHUNK) {
    const chunk = targets.slice(i, i + PLATFORM_BROADCAST_CHUNK);
    await prisma.notificationRecipient.createMany({
      data: chunk.map((contact) => ({
        notificationId: notification.id,
        contactId: contact.id,
      })),
      skipDuplicates: true,
    });
  }

  scheduleNotificationEmails(notification.id);
  return notification.id;
};

/**
 * Dispara el reparto por correo sin bloquear al llamante — nunca queremos un
 * viaje de ida y vuelta a Resend dentro del webhook de pagos.
 */
const scheduleNotificationEmails = (notificationId: string) => {
  const run = async () => {
    const { deliverNotificationEmails } = await import("./email");
    await deliverNotificationEmails(notificationId);
  };
  try {
    after(() => run().catch(() => undefined));
  } catch {
    void run().catch(() => undefined);
  }
};

/**
 * Emisión no bloqueante, para usar en el camino de una petición.
 *
 * Usa `after()` en vez de una promesa flotante: en Vercel la invocación puede
 * congelarse en cuanto se devuelve la respuesta, y una promesa suelta se pierde
 * en silencio. `after()` lanza fuera del ámbito de una petición (pasos de
 * Inngest, tools de eve, auth.ts), y ahí la invocación ya es de larga duración,
 * así que el `void` del catch es correcto.
 */
export const fireNotification = (input: EmitInput) => {
  try {
    after(() => emitPlatformNotification(input).catch(() => undefined));
  } catch {
    void emitPlatformNotification(input).catch(() => undefined);
  }
};
