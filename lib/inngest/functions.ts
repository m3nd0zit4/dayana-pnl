import {
  EnrollmentStatus,
  NotificationDeliveryStatus,
  PaymentStatus,
  ProductKind,
} from "@prisma/client";
import { inngest } from "./client";
import { prisma } from "../db";
import { isNotificationsEnabled } from "../notifications/config";
import { dispatchAndRecord } from "../notifications/dispatch";
import {
  BROADCAST_BATCH_SIZE,
  finalizeCampaignRun,
  loadCampaignRunContext,
  processCampaignBatch,
  startCampaignRun,
} from "../notifications/campaigns";
import { sendPaymentConfirmation } from "../notifications/payment-confirmation";
import { sendMemberInviteEmail } from "../notifications/member-emails";
import { renderQuickMessage } from "../crm/render-message";
import { abandonStalePlaceholderCheckouts } from "../crm/checkout-placeholder";
import { applyMembershipExtension } from "../lms/membership";
import { createMemberAuthToken } from "../auth/member-tokens";

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
      if (!isNotificationsEnabled()) return { skipped: "disabled" };
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

      await step.run("member-portal-invite", async () => {
        const contact = await prisma.contact.findUnique({
          where: { id: enrollment.contactId },
          select: {
            id: true,
            email: true,
            firstName: true,
            memberAccount: { select: { id: true } },
          },
        });
        if (!contact?.email) return { skipped: "no_email" };
        if (contact.memberAccount) return { skipped: "has_account" };

        const rawToken = await createMemberAuthToken({
          contactId: contact.id,
          purpose: "INVITE",
        });
        const { result } = await sendMemberInviteEmail({
          contactId: contact.id,
          firstName: contact.firstName,
          rawToken,
        });
        return { status: result.status };
      });
    }
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
        const vars = {
          first_name: contact.firstName,
          last_name: contact.lastName ?? "",
          display_name: contact.displayName ?? contact.firstName,
          phone: contact.phoneE164,
          session_date:
            scheduledAt?.toLocaleDateString("es-CO", { dateStyle: "long" }) ??
            "",
          session_time:
            scheduledAt?.toLocaleTimeString("es-CO", {
              hour: "2-digit",
              minute: "2-digit",
            }) ?? "",
          meet_url: session.meetUrl ?? "",
        };
        const rendered = renderQuickMessage(templateBody, vars);

        if (isNotificationsEnabled()) {
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
      await startCampaignRun(campaignId);
      return loaded.contacts.length;
    });

    for (let i = 0; i < contactCount; i += BROADCAST_BATCH_SIZE) {
      await step.run(`batch-${i}`, async () => {
        const ctx = await loadCampaignRunContext(campaignId);
        if (!ctx) throw new Error("Campaña no encontrada");
        return processCampaignBatch(ctx, i, BROADCAST_BATCH_SIZE);
      });
    }

    await step.run("finalize", () => finalizeCampaignRun(campaignId));

    return {
      contacts: contactCount,
      batches: Math.ceil(contactCount / BROADCAST_BATCH_SIZE),
    };
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

export const inngestFunctions = [
  paymentApprovedFn,
  sessionReminderFn,
  leadStaleFn,
  campaignBroadcastFn,
  staleCheckoutCleanupFn,
];
