import webpush from "web-push";

import { prisma } from "@/lib/db";

/**
 * Notificaciones push al teléfono o al computador del equipo (Web Push).
 *
 * Sin costo: el navegador (Chrome, Safari con la app instalada en la pantalla
 * de inicio) entrega el aviso con sonido aunque el CRM esté cerrado. Las
 * claves VAPID identifican al CRM ante el servicio de push del navegador; se
 * generan una sola vez (`bunx web-push generate-vapid-keys`) y viven en
 * variables de entorno.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Ruta interna que se abre al tocar el aviso. */
  href: string;
  /** Avisos con la misma etiqueta se reemplazan en vez de apilarse. */
  tag?: string;
  /** Pide que el aviso se quede en pantalla hasta que lo toquen. */
  urgent?: boolean;
};

export const webPushPublicKey = (): string | null =>
  process.env.WEB_PUSH_PUBLIC_KEY?.trim() || null;

let configured: boolean | null = null;

const configure = (): boolean => {
  if (configured !== null) return configured;
  const publicKey = webPushPublicKey();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(
    `mailto:${process.env.STAFF_OWNER_EMAIL?.trim() || "hola@dayanabeltran.com"}`,
    publicKey,
    privateKey
  );
  configured = true;
  return true;
};

export const isPushConfigured = (): boolean => configure();

/**
 * Envía a todos los dispositivos de esos miembros del equipo. Una suscripción
 * que el navegador dio de baja (404/410) se borra; el resto de errores se
 * registran y no frenan a los demás.
 */
export const sendPushToStaff = async (
  staffIds: string[],
  payload: PushPayload
): Promise<number> => {
  if (staffIds.length === 0 || !configure()) return 0;
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { staffUserId: { in: staffIds } },
  });
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 12, urgency: payload.urgent ? "high" : "normal" }
        );
        sent++;
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: new Date() },
        });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("[push] no se pudo enviar", status, e);
        }
      }
    })
  );
  return sent;
};
