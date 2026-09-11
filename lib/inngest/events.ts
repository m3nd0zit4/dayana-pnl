import { isInngestConfigured } from "./config";

export { isInngestConfigured, assertInngestKeysPaired } from "./config";

const shouldEmitInngest = (): boolean => {
  if (process.env.NODE_ENV !== "production") return true;
  return isInngestConfigured();
};

/**
 * Un pago quedó aprobado.
 *
 * De este evento cuelga TODO lo que la clienta espera después de pagar: el
 * correo de confirmación con su recibo en PDF, la invitación al portal, el
 * Purchase de Meta y la red de seguridad que suma el mes de membresía.
 *
 * Por eso no se puede tragar en silencio. Antes era un `console.warn` y ya:
 * el dinero entraba, nadie recibía nada, y no había forma de enterarse salvo
 * porque la clienta escribiera preguntando. Sigue sin lanzar —el cobro está
 * hecho y no se va a deshacer porque falle un aviso— pero deja constancia
 * donde alguien la va a ver.
 */
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
    console.error("[inngest] payment/approved emit failed", e);
    const message = e instanceof Error ? e.message : String(e);
    try {
      const { emitPlatformNotification } = await import(
        "@/lib/notifications/platform/emit"
      );
      await emitPlatformNotification({
        eventType: "SYSTEM_ALERT",
        title: "Un pago aprobado no disparó su confirmación",
        body:
          `El cobro está registrado, pero la clienta no ha recibido el correo ` +
          `ni su recibo, y el mes de membresía puede no haberse sumado. ${message}`,
        href: `/admin/enrollments/${enrollmentId}`,
        entityType: "Enrollment",
        entityId: enrollmentId,
        metadata: { enrollmentId },
        staff: "ALL",
      });
    } catch (notifyError) {
      console.error("[inngest] tampoco se pudo avisar al equipo", notifyError);
    }
  }
};

/**
 * Alguien terminó el cuestionario de terapias.
 *
 * No devuelve nada y se traga el error a propósito: lo que cuelga de aquí —el
 * `Lead` de la Conversions API y el aviso al equipo— es medición y
 * seguimiento. El diagnóstico ya está guardado y la persona ya va camino de su
 * resultado; que Inngest esté caído no puede tumbar el envío del formulario.
 */
export const emitDiagnosticCompleted = async (diagnosticId: string) => {
  if (!shouldEmitInngest()) return;
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "diagnostic/completed",
      data: { diagnosticId },
    });
  } catch (e) {
    console.warn("[inngest] diagnostic/completed emit failed", e);
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

/**
 * Dayana guardó (o cambió) el enlace de la reunión del webinar.
 *
 * Devuelve booleano: si no se encoló, la ruta lo envía en línea con `after()`.
 * El cron `webinar-mailer` es la red de seguridad — la cola pendiente es una
 * condición de la base de datos, no un mensaje que se pueda perder — pero
 * esperar hasta diez minutos para un enlace recién puesto es demasiado.
 */
export const emitWebinarMeetLinkChanged = async (
  webinarId: string
): Promise<boolean> => {
  if (!shouldEmitInngest()) return false;
  try {
    const { inngest } = await import("./client");
    await inngest.send({
      name: "webinar/meet-link.changed",
      data: { webinarId },
    });
    return true;
  } catch (e) {
    console.warn("[inngest] webinar/meet-link.changed emit failed", e);
    return false;
  }
};

/**
 * El precio de la mensualidad cambió y los proveedores ya lo aceptaron.
 *
 * Sirve para lo único que no queda hecho de forma síncrona: recorrer las
 * suscripciones vivas de Mercado Pago. En PayPal no hace falta —cambiar el plan
 * las alcanza a todas— y en MP puede haber muchas, así que va en segundo plano.
 */
export const emitPriceChanged = async (productId: string): Promise<boolean> => {
  if (!shouldEmitInngest()) return false;
  try {
    const { inngest } = await import("./client");
    await inngest.send({ name: "price/changed", data: { productId } });
    return true;
  } catch (e) {
    console.warn("[inngest] price/changed emit failed", e);
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
