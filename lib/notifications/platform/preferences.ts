import type { NotificationEventType, StaffRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  NOTIFICATION_CATALOG,
  staffEventTypesFor,
} from "./catalog";

export type ResolvedPreference = {
  eventType: NotificationEventType;
  inApp: boolean;
  email: boolean;
  /** true si el valor viene del catálogo y no de una fila guardada. */
  isDefault: boolean;
};

/**
 * Preferencias efectivas de un miembro del staff.
 *
 * Nunca se precrean filas: la ausencia de fila significa "usa el default del
 * catálogo". Eso evita un backfill en cada migración y evita que las
 * preferencias queden desincronizadas cada vez que se agrega un evento nuevo.
 */
export const resolveStaffPreferences = async (
  staffUserId: string,
  role: StaffRole
): Promise<ResolvedPreference[]> => {
  const rows = await prisma.staffNotificationPreference.findMany({
    where: { staffUserId },
    select: { eventType: true, inApp: true, email: true },
  });

  const saved = new Map(rows.map((row) => [row.eventType, row]));

  return staffEventTypesFor(role).map((eventType) => {
    const row = saved.get(eventType);
    if (row) {
      return { eventType, inApp: row.inApp, email: row.email, isDefault: false };
    }
    const entry = NOTIFICATION_CATALOG[eventType];
    return {
      eventType,
      inApp: entry.defaultInApp,
      email: entry.defaultEmail,
      isDefault: true,
    };
  });
};

export type PreferencePatch = {
  eventType: NotificationEventType;
  inApp: boolean;
  email: boolean;
};

/**
 * Guarda preferencias. Se ignoran los eventos que el rol no puede recibir, para
 * que un PATCH manipulado no pueda suscribir a alguien a eventos ajenos.
 */
export const setStaffPreferences = async (
  staffUserId: string,
  role: StaffRole,
  patch: PreferencePatch[]
) => {
  const allowed = new Set(staffEventTypesFor(role));
  const valid = patch.filter((item) => allowed.has(item.eventType));
  if (valid.length === 0) return 0;

  await prisma.$transaction(
    valid.map((item) =>
      prisma.staffNotificationPreference.upsert({
        where: {
          staffUserId_eventType: { staffUserId, eventType: item.eventType },
        },
        create: {
          staffUserId,
          eventType: item.eventType,
          inApp: item.inApp,
          email: item.email,
        },
        update: { inApp: item.inApp, email: item.email },
      })
    )
  );

  return valid.length;
};

export type StaffRecipient = {
  staffUserId: string;
  email: string;
  displayName: string;
  /** Preferencia efectiva de correo, ya combinada con el interruptor maestro. */
  wantsEmail: boolean;
};

/**
 * Miembros del staff que deben recibir un evento en la campana.
 *
 * Cruza tres cosas: los roles del catálogo, las filas de preferencias
 * guardadas, y el interruptor maestro `StaffUser.notifyEmail` (que se combina
 * con AND sobre la preferencia por evento — apagarlo silencia todo el correo
 * sin tocar la matriz).
 */
export const staffRecipientsFor = async (
  eventType: NotificationEventType
): Promise<StaffRecipient[]> => {
  const entry = NOTIFICATION_CATALOG[eventType];
  if (entry.audience === "MEMBER" || entry.roles.length === 0) return [];

  const staff = await prisma.staffUser.findMany({
    where: { isActive: true, role: { in: [...entry.roles] } },
    select: {
      id: true,
      email: true,
      displayName: true,
      notifyEmail: true,
      notificationPreferences: {
        where: { eventType },
        select: { inApp: true, email: true },
      },
    },
  });

  return staff.flatMap((member) => {
    const pref = member.notificationPreferences[0];
    const inApp = pref?.inApp ?? entry.defaultInApp;
    if (!inApp) return [];

    const wantsEmail = (pref?.email ?? entry.defaultEmail) && member.notifyEmail;
    return [
      {
        staffUserId: member.id,
        email: member.email,
        displayName: member.displayName,
        wantsEmail,
      },
    ];
  });
};
