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

/**
 * A quién se le puede escribir por WhatsApp: no se dio de baja y tiene un
 * número de verdad. Los contactos sin teléfono guardan un marcador
 * (`+pending:…`, `+nophone…`, `+google…`, `+signup…`): «+ seguido de un
 * dígito» los deja fuera a todos sin tener que listarlos.
 */
export const WHATSAPPABLE_CONTACT = {
  notifyWhatsapp: true,
  OR: ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => ({
    phoneE164: { startsWith: `+${d}` },
  })),
} satisfies Prisma.ContactWhereInput;

/** Sello de WhatsApp por pasada. */
export const waReminderFlag = (kind: ReminderKind) =>
  kind === "24h" ? ("reminder24hWaSentAt" as const) : ("reminder1hWaSentAt" as const);

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
  lastSendError: true,
  lastSendErrorAt: true,
  reminder24hWaSentAt: true,
  reminder1hWaSentAt: true,
  waReminderError: true,
  waReminderErrorAt: true,
  confirmationWaSentAt: true,
  confirmationWaError: true,
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phoneE164: true,
      countryIso: true,
      notifyEmail: true,
      notifyWhatsapp: true,
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
  opts: { take?: number; skip?: number; q?: string; failedOnly?: boolean } = {}
): Promise<WebinarRegistrationRow[]> => {
  const q = opts.q?.trim();
  return prisma.webinarRegistration.findMany({
    where: {
      webinarId,
      ...(opts.failedOnly
        ? { OR: [{ lastSendError: { not: null } }, { waReminderError: { not: null } }] }
        : {}),
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
  pendingLink: number;
  failed: number;
  /** WhatsApp: recordatorios sellados (enviados o intentados con error). */
  wa24h: number;
  wa1h: number;
  waFailed: number;
  /** Sin número de WhatsApp o dadas de baja: el WhatsApp no les llega. */
  noWhatsApp: number;
  /** Confirmación por WhatsApp al inscribirse que sí salió. */
  waConfirmation: number;
}> => {
  const [
    total,
    linkSent,
    reminder24h,
    reminder1h,
    unreachable,
    pendingLink,
    failed,
    wa24h,
    wa1h,
    waFailed,
    noWhatsApp,
    waConfirmation,
  ] =
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
      prisma.webinarRegistration.count({
        where: { webinarId, linkEmailSentAt: null, contact: EMAILABLE_CONTACT },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, lastSendError: { not: null } },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, reminder24hWaSentAt: { not: null }, waReminderError: null },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, reminder1hWaSentAt: { not: null }, waReminderError: null },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, waReminderError: { not: null } },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, contact: { NOT: WHATSAPPABLE_CONTACT } },
      }),
      prisma.webinarRegistration.count({
        where: { webinarId, confirmationWaSentAt: { not: null }, confirmationWaError: null },
      }),
    ]);
  return {
    total,
    linkSent,
    reminder24h,
    reminder1h,
    unreachable,
    pendingLink,
    failed,
    wa24h,
    wa1h,
    waFailed,
    noWhatsApp,
    waConfirmation,
  };
};

/** A quiénes les falta el recordatorio de WhatsApp de esa pasada (vista previa). */
export const listPendingWaReminderContactIds = async (
  webinarId: string,
  kind: ReminderKind,
  take = 2000
): Promise<string[]> =>
  (
    await prisma.webinarRegistration.findMany({
      where: { webinarId, [waReminderFlag(kind)]: null, contact: WHATSAPPABLE_CONTACT },
      select: { contactId: true },
      take,
    })
  ).map((r) => r.contactId);

/** El evento de una inscripción, o null si ya no existe. */
export const registrationEventId = async (registrationId: string): Promise<string | null> =>
  (
    await prisma.webinarRegistration.findUnique({
      where: { id: registrationId },
      select: { webinarId: true },
    })
  )?.webinarId ?? null;

/** «Reintentar WA»: suelta el sello de esa pasada y su error. */
export const releaseWaReminder = async (registrationId: string, kind: ReminderKind): Promise<void> => {
  await prisma.webinarRegistration.update({
    where: { id: registrationId },
    data: { [waReminderFlag(kind)]: null, waReminderError: null, waReminderErrorAt: null },
  });
};

/** Todas las personas inscritas a un evento (para «enviar a todas»). */
export const listRegistrationContactIds = async (webinarId?: string | null): Promise<string[]> => [
  ...new Set(
    (
      await prisma.webinarRegistration.findMany({
        where: webinarId ? { webinarId } : {},
        select: { contactId: true },
      })
    ).map((r) => r.contactId)
  ),
];

/** Cuántas esperan todavía un recordatorio de WhatsApp de esa pasada. */
export const countPendingWaReminderRecipients = async (
  webinarId: string,
  kind: ReminderKind
): Promise<number> =>
  prisma.webinarRegistration.count({
    where: { webinarId, [waReminderFlag(kind)]: null, contact: WHATSAPPABLE_CONTACT },
  });

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
        { reminder24hWaSentAt: { not: null } },
        { reminder1hWaSentAt: { not: null } },
        { waReminderError: { not: null } },
      ],
    },
    // Los de WhatsApp también: el recordatorio dice la fecha, y uno con la
    // fecha vieja es peor que ninguno.
    data: {
      reminder24hSentAt: null,
      reminder1hSentAt: null,
      reminder24hWaSentAt: null,
      reminder1hWaSentAt: null,
      waReminderError: null,
      waReminderErrorAt: null,
    },
  });
  return count;
};

/** Devuelve a la cola un solo recordatorio (el reenvio masivo por pasada). */
export const resetOneReminder = async (
  webinarId: string,
  kind: ReminderKind
): Promise<number> => {
  const { count } = await prisma.webinarRegistration.updateMany({
    where: { webinarId, [reminderFlag(kind)]: { not: null } },
    data: { [reminderFlag(kind)]: null },
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

/**
 * El envío falló: se devuelve a la cola para el siguiente barrido y se guarda
 * el motivo EN LA MISMA sentencia. Separarlo en dos abriría una carrera: un
 * cron concurrente puede reclamar la fila, enviarla bien y limpiar el error
 * justo antes de que la primera escriba encima un error ya obsoleto.
 */
export const releaseRegistrationFlag = async (
  registrationId: string,
  flag: RegistrationFlag,
  errorMessage?: string | null
): Promise<void> => {
  await prisma.webinarRegistration.updateMany({
    where: { id: registrationId },
    data: {
      [flag]: null,
      lastSendError: errorMessage ?? null,
      lastSendErrorAt: errorMessage ? new Date() : null,
    },
  });
};

/**
 * Limpia el último error tras un envío correcto. El `not: null` evita 10k
 * escrituras inútiles en cada barrido que sale bien.
 */
export const clearRegistrationSendError = async (
  registrationId: string
): Promise<void> => {
  await prisma.webinarRegistration.updateMany({
    where: { id: registrationId, lastSendError: { not: null } },
    data: { lastSendError: null, lastSendErrorAt: null },
  });
};

/** Una fila concreta con su contacto — lo que necesita el reenvío individual. */
export const findRegistrationForResend = async (
  registrationId: string
): Promise<(WebinarMailRecipient & { webinarId: string }) | null> =>
  prisma.webinarRegistration.findUnique({
    where: { id: registrationId },
    select: { ...RECIPIENT_SELECT, webinarId: true },
  });
