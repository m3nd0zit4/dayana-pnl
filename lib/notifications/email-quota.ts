import { Prisma } from "@prisma/client";
import { getSiteSetting } from "@/lib/crm/site-settings";
import { prisma } from "@/lib/db";

/**
 * Memoria compartida de «la cuota de correo de Resend se agotó».
 *
 * Vive en `SiteSetting` y no en una variable del módulo porque en Vercel cada
 * invocación puede ser otra instancia: una bandera en memoria sólo frenaría a
 * la que la vio. Un fallo de lectura o escritura aquí nunca debe tumbar un
 * envío, así que todo se traga: sin bandera se comporta como antes.
 *
 * Se bloquea una hora y no hasta la medianoche a propósito. No sabemos si
 * Resend reinicia el tope a una hora fija o en ventana móvil; con una hora,
 * la siguiente pasada vuelve a sondear con UN envío. Si sigue agotada, ese
 * envío falla y la bandera se renueva; si ya se reinició, sale y se retoma la
 * cola. Cuesta como mucho un intento fallido por hora, no cientos.
 *
 * La bandera sólo gobierna los barridos AUTOMÁTICOS (webinar y talleres). Los
 * correos que se mandan uno a uno —confirmación de pago, invitación al portal,
 * el código de pago— y los envíos disparados a mano siguen intentando siempre.
 */

export const EMAIL_QUOTA_SETTING = "email.quota.blocked_until" as const;

export const EMAIL_QUOTA_BLOCK_MS = 60 * 60 * 1000;

/**
 * Cuánto tiene que llevar apagado el bloqueo anterior para que uno nuevo cuente
 * como OTRO apagado y avise otra vez. Sin esto, cada sondeo horario que falla
 * renovaba la bandera y avisaba de nuevo: un apagado de varios días daba ~24
 * avisos al día. Mientras el apagado sea continuo, el aviso es uno.
 */
export const EMAIL_QUOTA_ALERT_QUIET_MS = 12 * 60 * 60 * 1000;

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Activa (o renueva) el bloqueo. Devuelve `true` sólo cuando hay que AVISAR: es
 * el comienzo de un apagado nuevo y esta llamada es la que lo activa.
 *
 * Tiene que ser atómico: seis envíos en vuelo fallan casi a la vez y todos
 * llegan aquí. Un «leer y luego escribir» los deja a todos creyéndose el
 * primero (la prueba con un aviso por fallo dejó dos filas en la campana).
 * Gana exactamente uno:
 *
 * - `create` choca con la clave única si ya hay fila;
 * - si hay fila y su fecha sigue en el futuro, el bloqueo ya está activo: nada
 *   que hacer ni que avisar;
 * - si caducó (o el valor no es una fecha —alguien lo tocó a mano—, que se trata
 *   como caducado), se renueva con comparación sobre el valor EXACTO que se leyó:
 *   sólo una llamada concurrente casa, el resto ve el valor ya cambiado.
 */
export const markEmailQuotaExhausted = async (
  now: Date = new Date()
): Promise<boolean> => {
  const until = new Date(now.getTime() + EMAIL_QUOTA_BLOCK_MS).toISOString();
  try {
    await prisma.siteSetting.create({
      data: { key: EMAIL_QUOTA_SETTING, value: until },
    });
    return true;
  } catch (e) {
    if (!isUniqueViolation(e)) {
      console.error("[email-quota] no se pudo guardar la bandera", e);
      return false;
    }
  }
  try {
    const row = await prisma.siteSetting.findUnique({
      where: { key: EMAIL_QUOTA_SETTING },
      select: { value: true },
    });
    if (!row) return false;
    const previous = Date.parse(row.value);
    if (Number.isFinite(previous) && previous > now.getTime()) return false;

    const renewed = await prisma.siteSetting.updateMany({
      where: { key: EMAIL_QUOTA_SETTING, value: row.value },
      data: { value: until },
    });
    if (renewed.count !== 1) return false;
    return (
      !Number.isFinite(previous) ||
      previous < now.getTime() - EMAIL_QUOTA_ALERT_QUIET_MS
    );
  } catch (e) {
    console.error("[email-quota] no se pudo renovar la bandera", e);
    return false;
  }
};

/** Hasta cuándo seguir sin intentar envíos masivos, o `null` si no hay bloqueo vigente. */
export const emailQuotaBlockedUntil = async (
  now: Date = new Date()
): Promise<Date | null> => {
  try {
    const raw = await getSiteSetting(EMAIL_QUOTA_SETTING);
    if (!raw) return null;
    const until = new Date(raw);
    return Number.isNaN(until.getTime()) || until <= now ? null : until;
  } catch {
    return null;
  }
};
