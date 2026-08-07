import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Estado de envío por persona registrada al webinar gratuito.
 *
 * Los contactos ya llevan la etiqueta `webinar-gratuito`; esta tabla existe
 * porque «a quién le falta el enlace» y «a quién le falta el recordatorio» son
 * preguntas por persona, no por ventana de tiempo. Una columna sellada no se
 * desincroniza si el cron se retrasa, se reintenta o se despliega dos veces.
 */

/** Columnas de sello. El claim/release las trata de forma genérica. */
export type RegistrationFlag =
  | "linkEmailSentAt"
  | "reminder24hSentAt"
  | "reminder1hSentAt";

export type ReminderKind = "24h" | "1h";

export const reminderFlag = (kind: ReminderKind): RegistrationFlag =>
  kind === "24h" ? "reminder24hSentAt" : "reminder1hSentAt";

/**
 * Solo entran a la cola quienes pueden recibir correo. Se filtra en el `where`
 * y nunca sellando: si a un contacto se le añade el correo más tarde, tiene que
 * seguir siendo alcanzable. `notifyEmail` lo apaga solo el webhook de rebotes
 * de Resend, así que respetarlo no es opcional.
 */
const EMAILABLE_CONTACT = {
  email: { not: null },
  notifyEmail: true,
} satisfies Prisma.ContactWhereInput;

const RECIPIENT_SELECT = {
  id: true,
  contactId: true,
  contact: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} satisfies Prisma.WebinarRegistrationSelect;

export type WebinarMailRecipient = Prisma.WebinarRegistrationGetPayload<{
  select: typeof RECIPIENT_SELECT;
}>;

const LIST_SELECT = {
  id: true,
  createdAt: true,
  linkEmailSentAt: true,
  reminder24hSentAt: true,
  reminder1hSentAt: true,
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phoneE164: true,
      countryIso: true,
      notifyEmail: true,
    },
  },
} satisfies Prisma.WebinarRegistrationSelect;

export type WebinarRegistrationRow = Prisma.WebinarRegistrationGetPayload<{
  select: typeof LIST_SELECT;
}>;

/**
 * Idempotente. `update: {}` a propósito — volver a registrarse no debe borrar
 * el sello de un enlace ya enviado.
 *
 * `linkAlreadySent` lo pone el flujo de registro cuando el correo de
 * confirmación ya llevaba el enlace dentro; sin eso el fan-out mandaría un
 * segundo correo con lo mismo minutos después.
 */
export const recordWebinarRegistration = async (
  webinarId: string,
  contactId: string,
  opts: { linkAlreadySent?: boolean } = {}
): Promise<void> => {
  await prisma.webinarRegistration.upsert({
    where: { webinarId_contactId: { webinarId, contactId } },
    create: {
      webinarId,
      contactId,
      linkEmailSentAt: opts.linkAlreadySent ? new Date() : null,
    },
    update: {},
  });
};

/**
 * Página del panel. Nunca carga la tabla entera: con 10k registradas, traerlas
 * todas revienta la memoria del servidor y el DOM del navegador por igual.
 */
export const listWebinarRegistrations = async (
  webinarId: string,
  opts: { take?: number; skip?: number; q?: string } = {}
): Promise<WebinarRegistrationRow[]> => {
  const q = opts.q?.trim();
  return prisma.webinarRegistration.findMany({
    where: {
      webinarId,
      ...(q
        ? {
            contact: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phoneE164: { contains: q } },
              ],
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    skip: opts.skip ?? 0,
    select: LIST_SELECT,
  });
};

/** Contadores para la cabecera del panel — agregados, no filas. */
export const webinarRegistrationStats = async (
  webinarId: string
): Promise<{
  total: number;
  linkSent: number;
  reminder24h: number;
  reminder1h: number;
  unreachable: number;
}> => {
  const [total, linkSent, reminder24h, reminder1h, unreachable] =
    await prisma.$transaction([
      prisma.webinarRegistration.count({ where: { webinarId } }),
      prisma.webinarRegistration.count({
        where: { webinarId, linkEmailSentAt: { not: null } },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, reminder24hSentAt: { not: null } },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, reminder1hSentAt: { not: null } },
      }),
      prisma.webinarRegistration.count({
        where: {
          webinarId,
          OR: [{ contact: { email: null } }, { contact: { notifyEmail: false } }],
        },
      }),
    ]);
  return { total, linkSent, reminder24h, reminder1h, unreachable };
};

export const countPendingLinkRecipients = async (
  webinarId: string
): Promise<number> =>
  prisma.webinarRegistration.count({
    where: { webinarId, linkEmailSentAt: null, contact: EMAILABLE_CONTACT },
  });

export const countPendingReminderRecipients = async (
  webinarId: string,
  kind: ReminderKind
): Promise<number> =>
  prisma.webinarRegistration.count({
    where: { webinarId, [reminderFlag(kind)]: null, contact: EMAILABLE_CONTACT },
  });

export const countWebinarRegistrations = async (
  webinarId: string
): Promise<number> => prisma.webinarRegistration.count({ where: { webinarId } });

/** Cambió el enlace → todo el mundo vuelve a la cola. Ese es el «reenvío». */
export const resetLinkEmails = async (webinarId: string): Promise<number> => {
  const { count } = await prisma.webinarRegistration.updateMany({
    where: { webinarId, linkEmailSentAt: { not: null } },
    data: { linkEmailSentAt: null },
  });
  return count;
};

/** Se reprogramó la fecha → los recordatorios ya enviados dejan de valer. */
export const resetReminders = async (webinarId: string): Promise<number> => {
  const { count } = await prisma.webinarRegistration.updateMany({
    where: {
      webinarId,
      OR: [
        { reminder24hSentAt: { not: null } },
        { reminder1hSentAt: { not: null } },
      ],
    },
    data: { reminder24hSentAt: null, reminder1hSentAt: null },
  });
  return count;
};

export const findPendingLinkRecipients = async (
  webinarId: string,
  take = 500
): Promise<WebinarMailRecipient[]> =>
  prisma.webinarRegistration.findMany({
    where: { webinarId, linkEmailSentAt: null, contact: EMAILABLE_CONTACT },
    orderBy: { createdAt: "asc" },
    take,
    select: RECIPIENT_SELECT,
  });

export const findPendingReminderRecipients = async (
  webinarId: string,
  kind: ReminderKind,
  take = 500
): Promise<WebinarMailRecipient[]> =>
  prisma.webinarRegistration.findMany({
    where: {
      webinarId,
      [reminderFlag(kind)]: null,
      contact: EMAILABLE_CONTACT,
    },
    orderBy: { createdAt: "asc" },
    take,
    select: RECIPIENT_SELECT,
  });

/**
 * Sella la columna solo si seguía vacía. `count === 1` significa «este proceso
 * se quedó con el envío»; dos crons solapados no pueden ganar los dos.
 */
export const claimRegistrationFlag = async (
  registrationId: string,
  flag: RegistrationFlag
): Promise<boolean> => {
  const { count } = await prisma.webinarRegistration.updateMany({
    where: { id: registrationId, [flag]: null },
    data: { [flag]: new Date() },
  });
  return count === 1;
};

/** El envío falló: se devuelve a la cola para el siguiente barrido. */
export const releaseRegistrationFlag = async (
  registrationId: string,
  flag: RegistrationFlag
): Promise<void> => {
  await prisma.webinarRegistration.updateMany({
    where: { id: registrationId },
    data: { [flag]: null },
  });
};
