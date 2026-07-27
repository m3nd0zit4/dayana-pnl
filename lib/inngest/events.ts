import { isInngestConfigured } from "./config";

export { isInngestConfigured, assertInngestKeysPaired } from "./config";

const shouldEmitInngest = (): boolean => {
  if (process.env.NODE_ENV !== "production") return true;
  return isInngestConfigured();
};

export const emitPaymentApproved = async (enrollmentId: string) => {
  if (!shouldEmitInngest()) {
    return;
  }
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "payment/approved",
      data: { enrollmentId },
    });
  } catch (e) {
    console.warn("[inngest] payment/approved emit failed", e);
  }
};

export const emitLeadStale = async (enrollmentId: string) => {
  if (!shouldEmitInngest()) return;
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "enrollment/lead.stale",
      data: { enrollmentId },
    });
  } catch {
    /* optional */
  }
};

/**
 * Saca el reparto por correo de una notificación del camino de la petición.
 *
 * `deliverNotificationEmails` es idempotente (estampa `emailedAt` por
 * destinatario), así que convivir con el `after()` de emit.ts es seguro: la
 * segunda pasada no encuentra destinatarios pendientes y no envía nada.
 */
/**
 * A diferencia del resto de emisores de este archivo, devuelve un booleano: el
 * llamante (scheduleNotificationEmails en platform/emit.ts) necesita saber si
 * el trabajo quedó realmente encolado para, si no, repartir el correo en
 * proceso. Devolver void haría que el respaldo se ejecutara siempre.
 */
export const emitPlatformNotificationEmail = async (
  notificationId: string
): Promise<boolean> => {
  if (!shouldEmitInngest()) return false;
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "notification/platform.email",
      data: { notificationId },
    });
    return true;
  } catch (e) {
    console.warn("[inngest] notification/platform.email emit failed", e);
    return false;
  }
};

/**
 * Encola un evento entrante de Meta.
 *
 * Devuelve un booleano, como `emitPlatformNotificationEmail`: si no se pudo
 * encolar, la ruta del webhook lo procesa en línea. Un mensaje de un cliente no
 * puede desaparecer porque Inngest no esté configurado — a diferencia de un
 * correo de notificación, aquí no hay segunda oportunidad.
 */
export const emitMetaWebhook = async (data: {
  object: string;
  threadKey: string;
  event: unknown;
}): Promise<boolean> => {
  if (!shouldEmitInngest()) return false;
  try {
    const { inngest } = await import("./client");
    await inngest.send({ name: "meta/webhook.received", data });
    return true;
  } catch (e) {
    console.warn("[inngest] meta/webhook.received emit failed", e);
    return false;
  }
};

/**
 * Encola la publicación de una entrada en redes.
 *
 * Devuelve booleano porque el llamante ("publicar ahora") necesita poder decir
 * que no se encoló, en vez de dejar al operador esperando una publicación que
 * nunca se intentó.
 */
export const emitSocialPostPublish = async (
  postId: string
): Promise<boolean> => {
  if (!shouldEmitInngest()) return false;
  try {
    const { inngest } = await import("./client");
    await inngest.send({ name: "social/post.publish", data: { postId } });
    return true;
  } catch (e) {
    console.warn("[inngest] social/post.publish emit failed", e);
    return false;
  }
};

export const emitCampaignRun = async (campaignId: string) => {
  if (!shouldEmitInngest()) return;
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "notification/campaign.run",
      data: { campaignId },
    });
  } catch (e) {
    console.warn("[inngest] notification/campaign.run emit failed", e);
  }
};
