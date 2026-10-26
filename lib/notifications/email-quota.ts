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
 */

export const EMAIL_QUOTA_SETTING = "email.quota.blocked_until" as const;

export const EMAIL_QUOTA_BLOCK_MS = 60 * 60 * 1000;

/**
 * Activa (o renueva) el bloqueo. Devuelve `true` sólo a quien lo ACTIVA de
 * verdad —no había bloqueo vigente—, y es lo que decide quién avisa al equipo.
 *
 * Tiene que ser atómico: seis envíos en vuelo fallan casi a la vez y todos
 * llegan aquí. Un «leer y luego escribir» los deja a todos creyéndose el
 * primero (la prueba con un aviso por fallo dejó dos filas en la campana). Aquí
 * gana exactamente uno: `create` choca con la clave única si ya hay fila, y el
 * `updateMany` sólo casa con una fila caducada — una vez renovada deja de
 * casar para los demás. Las fechas ISO se comparan como texto, que en este
 * formato es comparar en el tiempo.
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
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) {
      console.error("[email-quota] no se pudo guardar la bandera", e);
      return false;
    }
  }
  try {
    const renewed = await prisma.siteSetting.updateMany({
      where: { key: EMAIL_QUOTA_SETTING, value: { lt: now.toISOString() } },
      data: { value: until },
    });
    return renewed.count === 1;
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
