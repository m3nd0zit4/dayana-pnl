import {
  EnrollmentStatus,
  NotificationDeliveryStatus,
  PaymentStatus,
  ProductKind,
} from "@prisma/client";
import { inngest } from "./client";
import { prisma } from "../db";
import { siteUrl } from "../notifications/config";
import { dispatchAndRecord } from "../notifications/dispatch";
import { resolveNotificationsEnabled } from "../notifications/platform/resolve";
import {
  BROADCAST_BATCH_SIZE,
  BROADCAST_MAX_BATCHES,
  finalizeCampaignRun,
  loadCampaignRunContext,
  processCampaignBatch,
  startCampaignRun,
} from "../notifications/campaigns";
import { sendPaymentConfirmation } from "../notifications/payment-confirmation";
import { deliverNotificationEmails } from "../notifications/platform/email";
import { emitPlatformNotification } from "../notifications/platform/emit";
import {
  NOTIFICATION_RETENTION_RULES,
  runNotificationRetentionRule,
} from "../notifications/platform/retention";
import { processNormalizedEvent } from "../meta/ingest";
import type { NormalizedEvent } from "../meta/inbound";
import { findDuePosts } from "../crm/social-posts";
import {
  drainWebinarMail,
  type WebinarMailPass,
} from "../crm/webinar-mailer";
import { closeFreeWebinarIfDue, getFreeWebinar } from "../crm/free-webinar";
import { publishSocialPost } from "../tiktok/publisher";
import { renderQuickMessage } from "../crm/render-message";
import { formatInstantForContact } from "../datetime/visitor-schedule";
import { abandonStalePlaceholderCheckouts } from "../crm/checkout-placeholder";
import { inviteContactToPortal } from "../crm/member-accounts";
import { applyMembershipExtension } from "../lms/membership";
import { RECORDING_RETENTION_DAYS } from "../lms/course-content";
import { sendPurchaseToMetaCapi } from "../meta/capi-purchase";

export const paymentApprovedFn = inngest.createFunction(
  { id: "payment-approved" },
  { event: "payment/approved" },
  async ({ event, step }) => {
    const enrollmentId = event.data.enrollmentId as string;

    const enrollment = await step.run("load-enrollment", async () =>
      prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: { contact: true, product: true },
      })
    );

    if (!enrollment) return { skipped: "enrollment_not_found" };

    await step.run("payment-confirmation-notifications", async () => {
      if (!(await resolveNotificationsEnabled())) return { skipped: "disabled" };
      return sendPaymentConfirmation(enrollmentId);
    });

    if (enrollment.product.kind === ProductKind.COURSE) {
      // Safety net for extensions recordPayment swallowed (idempotent —
      // membershipAppliedAt marks payments already counted).
      await step.run("ensure-membership-extension", async () => {
        const pending = await prisma.payment.findMany({
          where: {
            enrollmentId,
            status: PaymentStatus.APPROVED,
            membershipAppliedAt: null,
          },
          select: { id: true },
        });
        let extended = 0;
        for (const payment of pending) {
          const result = await applyMembershipExtension(payment.id);
          if (result.extended) extended += 1;
        }
        return { pending: pending.length, extended };
      });
    }

    // Every buyer gets a portal-account invite, regardless of product kind
    // — an account is how they get back to gated content and self-service
    // account management. Skips automatically if they already have one.
    await step.run("member-portal-invite", async () =>
      inviteContactToPortal(enrollment.contactId)
    );

    // Meta CAPI: la mitad servidor del Purchase. El Pixel del navegador manda
    // el mismo evento con el mismo `event_id` y Meta lo cuenta una sola vez.
    await step.run("meta-capi-purchase", async () =>
      sendPurchaseToMetaCapi(enrollmentId)
    );
  }
);

export const sessionReminderFn = inngest.createFunction(
  { id: "therapy-session-reminder" },
  { cron: "0 14 * * *" },
  async ({ step }) => {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const in25h = new Date(Date.now() + 25 * 60 * 60 * 1000);

    const sessions = await step.run("find-upcoming-sessions", async () =>
      prisma.therapySession.findMany({
        where: {
          status: "SCHEDULED",
          scheduledAt: { gte: in24h, lte: in25h },
        },
        include: {
          therapyPackage: {
            include: {
              enrollment: { include: { contact: true } },
            },
          },
        },
      })
    );

    const template = await step.run("load-reminder-template", async () =>
      prisma.messageTemplate.findUnique({
        where: { key_locale: { key: "session_reminder", locale: "es" } },
      })
    );

    const templateBody =
      template?.body ??
      "Hola {{first_name}}, te recuerdo tu sesión el {{session_date}}.";

    let sent = 0;

    for (const session of sessions) {
      const contact = session.therapyPackage.enrollment.contact;
      const scheduledAt =
        session.scheduledAt != null
          ? new Date(session.scheduledAt as string | Date)
          : null;

      await step.run(`reminder-${session.id}`, async () => {
        const formatted = scheduledAt
          ? formatInstantForContact(scheduledAt, {
              timezone: contact.timezone,
              countryIso: contact.countryIso ?? contact.phoneCountryIso,
            })
          : null;
        const vars = {
          first_name: contact.firstName,
          last_name: contact.lastName ?? "",
          display_name: contact.displayName ?? contact.firstName,
          phone: contact.phoneE164,
          session_date: formatted?.date ?? "",
          session_time: formatted?.timeWithPlace ?? "",
          meet_url: session.meetUrl ?? "",
        };
        const rendered = renderQuickMessage(templateBody, vars);

        if (await resolveNotificationsEnabled()) {
          for (const channel of ["EMAIL", "SMS", "WHATSAPP_API"] as const) {
            const { result } = await dispatchAndRecord({
              contactId: contact.id,
              channel,
              templateKey: "session_reminder",
              body: rendered,
              vars,
            });
            if (result.status === NotificationDeliveryStatus.SENT) sent += 1;
          }
          return;
        }

        await prisma.messageLog.create({
          data: {
            contactId: contact.id,
            bodySnapshot: rendered,
            channel: "INTERNAL",
          },
        });
      });
    }

    return { sessions: sessions.length, sent };
  }
);

export const leadStaleFn = inngest.createFunction(
  { id: "lead-stale-followup" },
  { event: "enrollment/lead.stale" },
  async ({ event, step }) => {
    const enrollmentId = event.data.enrollmentId as string;

    await step.run("check-still-lead", async () => {
      const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
      });
      if (!enrollment || enrollment.status !== EnrollmentStatus.LEAD) {
        return { skipped: true };
      }

      return { stillLead: true };
    });
  }
);

export const campaignBroadcastFn = inngest.createFunction(
  { id: "notification-campaign-run" },
  { event: "notification/campaign.run" },
  async ({ event, step }) => {
    const campaignId = event.data.campaignId as string;

    const contactCount = await step.run("start-campaign", async () => {
      const loaded = await loadCampaignRunContext(campaignId);
      if (!loaded) throw new Error("Campaña no encontrada");
      const started = await startCampaignRun(campaignId);
      return started.contactCount;
    });

    // Bucle por cursor, no por offset. Antes cada paso recargaba el contexto,
    // que leía la tabla de contactos ENTERA, y descartaba todo salvo su
    // rebanada: a 100k eran 4.000 pasos × 100k filas. Ahora cada paso lee solo
    // su lote, así que el coste total es una pasada por la audiencia.
    let cursor: string | null = null;
    let batches = 0;
    do {
      const batch: { nextCursor: string | null } = await step.run(
        `batch-${batches}`,
        async () => {
          const ctx = await loadCampaignRunContext(campaignId);
          if (!ctx) throw new Error("Campaña no encontrada");
          return processCampaignBatch(ctx, cursor, BROADCAST_BATCH_SIZE);
        }
      );
      cursor = batch.nextCursor;
      batches += 1;
      if (batches > BROADCAST_MAX_BATCHES) throw new Error("demasiados lotes");
    } while (cursor);

    await step.run("finalize", () => finalizeCampaignRun(campaignId));

    return { contacts: contactCount, batches };
  }
);

export const staleCheckoutCleanupFn = inngest.createFunction(
  { id: "stale-checkout-cleanup" },
  { cron: "0 5 * * *" },
  async ({ step }) => {
    const abandoned = await step.run("abandon-stale-checkouts", () =>
      abandonStalePlaceholderCheckouts()
    );
    return { abandoned };
  }
);

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMBERSHIP_REMINDER_CHANNELS = ["EMAIL", "WHATSAPP_API"] as const;

/**
 * Daily membership reminders. Each window is exactly one day wide and the
 * cron runs once a day, so every enrollment gets at most one "due soon" and
 * one "overdue" notice per cycle — no dedupe table needed.
 */
export const membershipDueReminderFn = inngest.createFunction(
  { id: "membership-due-reminder" },
  { cron: "0 13 * * *" },
  async ({ step }) => {
    const now = Date.now();
    const windows = [
      {
        key: "membership_payment_due",
        eventType: "MEMBERSHIP_DUE_SOON" as const,
        gte: new Date(now + 3 * DAY_MS),
        lt: new Date(now + 4 * DAY_MS),
        fallback:
          "Hola {{first_name}}, tu mensualidad del curso vence el {{paid_until_date}}. Renueva aquí: {{portal_url}}",
      },
      {
        key: "membership_overdue",
        eventType: "MEMBERSHIP_OVERDUE" as const,
        gte: new Date(now - 2 * DAY_MS),
        lt: new Date(now - 1 * DAY_MS),
        fallback:
          "Hola {{first_name}}, tu mensualidad del curso venció el {{paid_until_date}}. Renueva aquí: {{portal_url}}",
      },
    ];

    let sent = 0;
    let targets = 0;

    for (const window of windows) {
      const enrollments = await step.run(`find-${window.key}`, async () =>
        prisma.enrollment.findMany({
          where: {
            status: EnrollmentStatus.ACTIVE,
            product: { kind: ProductKind.COURSE },
            paidUntil: { gte: window.gte, lt: window.lt },
          },
          include: { contact: true },
        })
      );

      const template = await step.run(`template-${window.key}`, async () =>
        prisma.messageTemplate.findUnique({
          where: { key_locale: { key: window.key, locale: "es" } },
        })
      );
      const body = template?.body ?? window.fallback;

      for (const enrollment of enrollments) {
        targets += 1;
        await step.run(`${window.key}-${enrollment.id}`, async () => {
          const contact = enrollment.contact;
          const paidUntil = enrollment.paidUntil
            ? new Date(enrollment.paidUntil as string | Date)
            : null;
          const vars = {
            first_name: contact.firstName,
            paid_until_date:
              paidUntil?.toLocaleDateString("es-CO", { dateStyle: "long" }) ??
              "",
            portal_url: `${siteUrl()}/miembros`,
          };
          const rendered = renderQuickMessage(body, vars);

          if (!(await resolveNotificationsEnabled())) {
            await prisma.messageLog.create({
              data: {
                contactId: contact.id,
                bodySnapshot: rendered,
                channel: "INTERNAL",
              },
            });
            return;
          }

          for (const channel of MEMBERSHIP_REMINDER_CHANNELS) {
            const { result } = await dispatchAndRecord({
              contactId: contact.id,
              channel,
              templateKey: window.key,
              body: rendered,
              vars,
            });
            if (result.status === NotificationDeliveryStatus.SENT) sent += 1;
          }
        });

        // Paso aparte a propósito: si el envío de mensajes se reintenta, el
        // step memoizado de arriba no vuelve a correr y esto tampoco duplica
        // la notificación del feed.
        await step.run(`notify-${window.key}-${enrollment.id}`, async () => {
          const contact = enrollment.contact;
          const paidUntil = enrollment.paidUntil
            ? new Date(enrollment.paidUntil as string | Date)
            : null;
          const paidUntilLabel =
            paidUntil?.toLocaleDateString("es-CO", { dateStyle: "long" }) ?? "";
          const memberName = contact.displayName ?? contact.firstName;
          const dueSoon = window.eventType === "MEMBERSHIP_DUE_SOON";

          return emitPlatformNotification({
            eventType: window.eventType,
            title: dueSoon
              ? `Mensualidad por vencer el ${paidUntilLabel}`
              : `Mensualidad vencida el ${paidUntilLabel}`,
            body: dueSoon
              ? `La mensualidad del curso de ${memberName} vence el ${paidUntilLabel}. Renueva desde el portal para no perder el acceso.`
              : `La mensualidad del curso de ${memberName} venció el ${paidUntilLabel}. El acceso al curso está en riesgo hasta que se registre el pago.`,
            // El portal es donde se resuelve; el staff ve al miembro en el
            // título y llega a la ficha desde el CRM.
            href: "/miembros",
            entityType: "Enrollment",
            entityId: enrollment.id,
            metadata: { contactId: contact.id, paidUntil: paidUntilLabel },
            contactIds: [contact.id],
            staff: "ALL",
          });
        });
      }
    }

    return { targets, sent };
  }
);

/** Hides class recordings 30 days after they were posted (URL kept for staff).
 *  Evergreen library lessons are exempt — they are the course, not a replay. */
export const recordingAutoHideFn = inngest.createFunction(
  { id: "recording-auto-hide" },
  { cron: "30 5 * * *" },
  async ({ step }) => {
    const hidden = await step.run("hide-expired-recordings", async () => {
      const cutoff = new Date(Date.now() - RECORDING_RETENTION_DAYS * DAY_MS);
      const result = await prisma.liveClassSession.updateMany({
        where: {
          OR: [{ recordingUrl: { not: null } }, { muxPlaybackId: { not: null } }],
          recordingHiddenAt: null,
          recordingPostedAt: { lt: cutoff },
          evergreen: false,
        },
        data: { recordingHiddenAt: new Date() },
      });
      return result.count;
    });
    return { hidden };
  }
);

/**
 * Reparte por correo una notificación del feed fuera del camino de la petición.
 *
 * `deliverNotificationEmails` solo toma destinatarios con `emailedAt` nulo y lo
 * estampa al terminar, así que es idempotente: convive sin duplicar con el
 * `after()` que emit.ts ya dispara, y un reintento de Inngest no reenvía nada.
 */
export const platformNotificationEmailFn = inngest.createFunction(
  { id: "platform-notification-email" },
  { event: "notification/platform.email" },
  async ({ event, step }) => {
    const notificationId = event.data.notificationId as string;
    return step.run("deliver-notification-emails", () =>
      deliverNotificationEmails(notificationId)
    );
  }
);

/**
 * Poda diaria del feed de notificaciones. Va a las 06:00 UTC, después del
 * cierre de checkouts (05:00) y del ocultado de grabaciones (05:30), para no
 * competir por la misma conexión de Neon.
 *
 * Cada regla corre en su propio paso: si una falla, las demás ya quedaron
 * confirmadas y el reintento no repite el trabajo hecho. Los borrados van
 * paginados dentro de `retention.ts` — ver ahí las claves de `SiteSetting`.
 */
export const notificationRetentionFn = inngest.createFunction(
  { id: "notification-retention" },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    const deleted: Record<string, number> = {};
    for (const rule of NOTIFICATION_RETENTION_RULES) {
      deleted[rule] = await step.run(`retention-${rule}`, () =>
        runNotificationRetentionRule(rule)
      );
    }
    return deleted;
  }
);

/**
 * Ingesta de los webhooks de Meta (WhatsApp, Messenger e Instagram).
 *
 * `concurrency` con clave por hilo y límite 1 es el punto importante: sin ella,
 * tres mensajes seguidos del mismo cliente se procesan en paralelo y el hilo
 * queda desordenado. La clave incluye el canal, así que hilos distintos siguen
 * avanzando a la vez.
 */
export const metaWebhookFn = inngest.createFunction(
  {
    id: "meta-webhook-received",
    concurrency: { key: "event.data.threadKey", limit: 1 },
    retries: 3,
  },
  { event: "meta/webhook.received" },
  async ({ event, step }) => {
    const object = event.data.object as string;
    const normalized = event.data.event as NormalizedEvent;

    return step.run("process-meta-event", () =>
      processNormalizedEvent(object, normalized)
    );
  }
);

/**
 * Barre las publicaciones cuya hora ya pasó y lanza una tarea por cada una.
 *
 * Cada 5 minutos: la granularidad de programación es "el minuto más cercano a
 * cinco", que para contenido de redes sobra. Un `sleepUntil` por publicación
 * sería más exacto pero deja tareas dormidas semanas, imposibles de cancelar
 * cuando el operador borra el post.
 */
export const socialPostSchedulerFn = inngest.createFunction(
  { id: "social-post-scheduler" },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const due = await step.run("find-due-posts", () => findDuePosts());
    if (due.length === 0) return { due: 0 };

    await Promise.all(
      due.map((post) =>
        step.sendEvent(`publish-${post.id}`, {
          name: "social/post.publish",
          data: { postId: post.id },
        })
      )
    );

    return { due: due.length };
  }
);

/**
 * Publica una entrada concreta.
 *
 * `retries: 0` es deliberado: `publishSocialPost` ya reclama la fila y registra
 * el fallo, y un reintento ciego arriesga subir el mismo vídeo dos veces si el
 * error ocurrió después de que TikTok lo aceptara.
 */
export const socialPostPublishFn = inngest.createFunction(
  {
    id: "social-post-publish",
    concurrency: { key: "event.data.postId", limit: 1 },
    retries: 0,
  },
  { event: "social/post.publish" },
  async ({ event, step }) => {
    const postId = event.data.postId as string;
    return step.run("publish-social-post", () => publishSocialPost(postId));
  }
);

/**
 * Embudo del webinar gratuito: enlace de la reunión y los dos recordatorios.
 *
 * Los minutos `:03 :13 :23 :33 :43 :53` esquivan al programador de redes
 * (`*​/5`) para no pelear por la misma conexión de Neon. Cada 10 minutos es
 * suficiente porque el recordatorio de 1 h se dispara en cuanto la ventana se
 * abre: como mucho llega diez minutos tarde, entre T-60 y T-50.
 *
 * Este cron es también la red de seguridad del enlace: «a quién le falta» es
 * una condición de la base de datos, así que un `inngest.send` perdido no deja
 * a nadie sin correo — solo lo retrasa hasta el siguiente barrido.
 */
export const webinarMailerFn = inngest.createFunction(
  { id: "webinar-mailer", concurrency: { limit: 1 } },
  { cron: "3-53/10 * * * *" },
  async ({ step }) => {
    // La guarda va aquí y no dentro del mailer: así los reenvíos manuales
    // siguen funcionando sobre una edición ya cerrada pero sin archivar.
    // `getFreeWebinar` y no `ensureFreeWebinar` — un cron no crea filas.
    const live = await step.run("load-live", () => getFreeWebinar());
    if (!live) return { skipped: "no_webinar" };

    const out: Record<string, unknown> = {};

    if (live.endedAt) {
      out.mail = { skipped: "ended" };
    } else {
      // Cada pasada vacía la cola en lotes de 500 con 10 envíos en vuelo, y se
      // corta sola antes del tope de 300 s de una función de Vercel. El
      // recordatorio de 1 h va primero: su ventana es la única irrecuperable.
      const passes: WebinarMailPass[] = ["1h", "24h", "link"];
      for (const pass of passes) {
        const r = await step.run(`webinar-${pass}`, () =>
          drainWebinarMail(pass)
        );
        out[pass] = r;
        // Se agotó el presupuesto con cola pendiente: se encadena otra
        // invocación en vez de alargar esta hasta que Vercel la mate.
        if (r.pending) {
          await step.sendEvent(`continue-${pass}`, {
            name: "webinar/mail.continue",
            data: { pass },
          });
        }
      }
    }

    // El cierre va al final para que este mismo tick alcance a enviar el
    // recordatorio de 1 h antes de dar el webinar por terminado.
    const closed = await step.run("close-if-due", () => closeFreeWebinarIfDue());
    out.close = closed;

    if (closed.closed) {
      // Sin este aviso nadie se entera de que ya se puede archivar.
      // `SYSTEM_ALERT` ya existe: un tipo nuevo costaría migración del enum
      // más una entrada en el catálogo exhaustivo, para un solo mensaje.
      await step.run("notify-ended", async () => {
        await emitPlatformNotification({
          eventType: "SYSTEM_ALERT",
          title: "El webinar gratuito ya terminó",
          body: "Se cerraron los registros y los recordatorios. Puedes archivarlo para dejar lista la próxima edición.",
          href: "/admin/webinar",
          entityType: "FreeWebinar",
          entityId: closed.webinar.id,
          staff: "ALL",
        });
        return { notified: true };
      });
    }

    return out;
  }
);

/**
 * Continuación de una pasada que no cupo en su presupuesto. Se reencola a sí
 * misma mientras quede cola. `concurrency` con clave por pasada y límite 1
 * impide que dos continuaciones de la misma cola corran a la vez — aunque los
 * sellos por fila ya evitarían el duplicado, así no se malgastan invocaciones.
 */
export const webinarMailContinueFn = inngest.createFunction(
  {
    id: "webinar-mail-continue",
    concurrency: { key: "event.data.pass", limit: 1 },
  },
  { event: "webinar/mail.continue" },
  async ({ event, step }) => {
    const pass = event.data.pass as WebinarMailPass;
    // Misma guarda que el cron: si la edición se cerró mientras la cola se
    // vaciaba, la continuación no debe seguir enviando.
    const live = await step.run("load-live", () => getFreeWebinar());
    if (!live || live.endedAt) return { skipped: "ended" };

    const r = await step.run(`drain-${pass}`, () => drainWebinarMail(pass));
    if (r.pending) {
      await step.sendEvent(`continue-${pass}`, {
        name: "webinar/mail.continue",
        data: { pass },
      });
    }
    return r;
  }
);

/**
 * Dayana acaba de guardar el enlace: se envía ya, sin esperar al cron.
 * `concurrency: 1` compartida con nada más, pero el reclamo por fila es lo que
 * de verdad impide que este envío y un tick del cron dupliquen un correo.
 */
export const webinarMeetLinkBroadcastFn = inngest.createFunction(
  { id: "webinar-meet-link-broadcast", concurrency: { limit: 1 } },
  { event: "webinar/meet-link.changed" },
  async ({ step }) =>
    step.run("send-link-emails", () => drainWebinarMail("link"))
);

/**
 * Red de seguridad del precio de la mensualidad.
 *
 * `changeSubscriptionPrice` ya impide que el CRM y los planes se separen, pero
 * hay una vía que no pasa por ahí: cambiar `PAYPAL_FEE_PERCENT` o
 * `MERCADOPAGO_FEE_PERCENT` mueve el bruto sin que nadie toque el precio. Esto
 * lo pilla, porque compara contra el importe **vivo** leído de cada proveedor.
 *
 * Sólo mira y canta: no escribe precios jamás.
 */
export const subscriptionPriceDriftCheckFn = inngest.createFunction(
  { id: "subscription-price-drift-check" },
  { cron: "0 7 * * *" },
  async ({ step }) => {
    const products = await step.run("list-subscription-products", async () => {
      const { prisma } = await import("@/lib/db");
      return prisma.product.findMany({
        where: {
          OR: [
            { paypalPlanId: { not: null } },
            { mercadoPagoPreapprovalPlanId: { not: null } },
          ],
        },
        select: { id: true },
      });
    });

    const results: { productId: string; inSync: boolean }[] = [];
    for (const product of products) {
      const res = await step.run(`verify-${product.id}`, async () => {
        const { verifyProductPriceSync } = await import(
          "@/lib/pricing/price-sync"
        );
        return verifyProductPriceSync(product.id);
      });
      results.push({ productId: product.id, inSync: res.inSync });
    }
    return { checked: results.length, drifted: results.filter((r) => !r.inSync).length };
  }
);

/**
 * Lleva el precio nuevo a las suscripciones vivas de Mercado Pago.
 *
 * En PayPal no hace falta: cambiar el plan las alcanza a todas. MP no garantiza
 * eso, así que se recorren una a una. Cada una en su propio `step.run` para que
 * un rechazo no arrastre a las demás — y un rechazo es posible: MP puede exigir
 * nueva autorización de la titular si el importe sube. Esa persona seguiría
 * pagando el precio anterior, así que el fallo se hace visible en vez de
 * tragárselo.
 */
export const subscriptionPricePropagateMpFn = inngest.createFunction(
  { id: "subscription-price-propagate-mp", concurrency: { limit: 1 } },
  { event: "price/changed" },
  async ({ event, step }) => {
    const productId = String(event.data.productId);

    const target = await step.run("resolve-target-amount", async () => {
      const { prisma } = await import("@/lib/db");
      const { grossUpInt, mercadoPagoFee } = await import("@/lib/pricing/fees");
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { prices: { where: { currency: "COP" }, orderBy: { validFrom: "desc" }, take: 1 } },
      });
      const net = product?.prices[0]?.amountMinor;
      if (!product?.mercadoPagoPreapprovalPlanId || !net) return null;
      return { grossCop: grossUpInt(net, mercadoPagoFee()).gross };
    });
    if (!target) return { skipped: "no_mercadopago_plan" };

    const subs = await step.run("list-live-subscriptions", async () => {
      const { prisma } = await import("@/lib/db");
      return prisma.enrollment.findMany({
        where: {
          productId,
          subscriptionStatus: "ACTIVE",
          mercadoPagoPreapprovalId: { not: null },
        },
        select: {
          id: true,
          mercadoPagoPreapprovalId: true,
          contact: { select: { firstName: true, lastName: true } },
        },
      });
    });

    let updated = 0;
    let failed = 0;
    for (const sub of subs) {
      const ok = await step.run(`update-${sub.id}`, async () => {
        const { updatePreapprovalAmount } = await import(
          "@/lib/mercadopago/subscriptions"
        );
        try {
          await updatePreapprovalAmount(
            sub.mercadoPagoPreapprovalId!,
            target.grossCop
          );
          return true;
        } catch (e) {
          const name = `${sub.contact.firstName} ${sub.contact.lastName ?? ""}`.trim();
          await emitPlatformNotification({
            eventType: "SUBSCRIPTION_PRICE_PROPAGATION_FAILED",
            title: `${name} sigue con el precio anterior`,
            body:
              `Mercado Pago rechazó actualizar su suscripción a ` +
              `${target.grossCop.toLocaleString("es-CO")} COP. ` +
              `${e instanceof Error ? e.message : String(e)}`,
            href: `/admin/enrollments/${sub.id}`,
            entityType: "Enrollment",
            entityId: sub.id,
            staff: "ALL",
          }).catch(() => undefined);
          return false;
        }
      });
      if (ok) updated += 1;
      else failed += 1;
    }

    return { updated, failed };
  }
);

export const inngestFunctions = [
  paymentApprovedFn,
  sessionReminderFn,
  leadStaleFn,
  campaignBroadcastFn,
  staleCheckoutCleanupFn,
  membershipDueReminderFn,
  recordingAutoHideFn,
  platformNotificationEmailFn,
  notificationRetentionFn,
  metaWebhookFn,
  socialPostSchedulerFn,
  socialPostPublishFn,
  webinarMailerFn,
  webinarMailContinueFn,
  webinarMeetLinkBroadcastFn,
  subscriptionPriceDriftCheckFn,
  subscriptionPricePropagateMpFn,
];
