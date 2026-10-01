import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  clearWebinarVideo,
  updateFreeWebinar,
  FREE_EVENT_LIFECYCLE_MESSAGE,
  FreeEventLifecycleError,
  FreeWebinarMeetUrlError,
  FreeWebinarPublishError,
  PUBLISH_BLOCKER_LABELS,
} from "@/lib/crm/free-webinar";
import { FREE_EVENT_PUBLIC_ROOT } from "@/lib/crm/free-event-rules";
import { siteUrl } from "@/lib/notifications/config";
import { requireWriteStaff, auditAgentWrite, getCallerStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Update the CURRENT free event's landing (/eventos-gratuitos) — the one get_free_webinar returns. Pass only fields you want to change. Schedule uses startsAtDate (YYYY-MM-DD) in the CRM operational timezone; startsAtTime (HH:mm) is optional until confirmed. Setting isActive true publishes it (requires headline, subheadline, date, and at least one learn item) and closes registrations of any other published event. To prepare a NEW event (another date) don't overwrite this one: tell Dayana to use «Nuevo evento» in /admin/eventos. Registrations are tagged webinar-gratuito.",
  inputSchema: z.object({
    isActive: z
      .boolean()
      .optional()
      .describe("true = publish public page + Enlaces CTA (closes any other published event); false = close registrations"),
    headline: z.string().min(1).max(300).optional(),
    subheadline: z.string().max(1000).nullable().optional(),
    body: z.string().max(2000).nullable().optional(),
    startsAtDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Calendar date in the CRM operational timezone"),
    startsAtTime: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/)
      .nullable()
      .optional()
      .describe(
        "Local time HH:mm in the CRM operational timezone; omit or null for date-only (time TBD)"
      ),
    clearSchedule: z
      .boolean()
      .optional()
      .describe("If true, clears startsAt (and cannot stay published)"),
    learnSectionTitle: z.string().max(120).nullable().optional(),
    learnItems: z.array(z.string().min(1).max(400)).max(12).optional(),
    faq: z
      .array(
        z.object({
          q: z.string().min(1).max(300),
          a: z.string().min(1).max(2000),
        })
      )
      .max(12)
      .optional(),
    clearVideo: z
      .boolean()
      .optional()
      .describe("If true, removes the promo video from the landing"),
    meetUrl: z
      .string()
      .url()
      .nullable()
      .optional()
      .describe(
        "Google Meet link. WARNING: saving a new or different link emails it to every registered attendee who does not have it yet. Pass null to remove it."
      ),
    ctaLabel: z.string().min(1).max(80).optional(),
    formTitle: z.string().min(1).max(120).optional(),
    metaTitle: z.string().max(120).nullable().optional(),
    metaDescription: z.string().max(320).nullable().optional(),
  }),
  approval: always(),
  async execute(input, ctx) {
    requireWriteStaff(ctx);

    const {
      startsAtDate,
      startsAtTime,
      clearSchedule,
      clearVideo,
      isActive,
      ...rest
    } = input;

    if (!startsAtDate && startsAtTime) {
      return {
        ok: false as const,
        error: "needs_date_with_time",
        message:
          "Si pasas startsAtTime también necesitas startsAtDate (zona operativa del CRM).",
      };
    }

    try {
      const actor = { staffUserId: getCallerStaff(ctx).staffId };
      if (clearVideo) await clearWebinarVideo();

      const { webinar, meetUrlChanged, linkEmailsReset, closedOthers } =
        await updateFreeWebinar(
          {
            ...rest,
            isActive: clearSchedule ? false : isActive,
            startsAtLocal: clearSchedule
              ? null
              : startsAtDate
                ? {
                    date: startsAtDate,
                    time: startsAtTime === undefined ? null : startsAtTime,
                  }
                : undefined,
          },
          undefined,
          actor
        );

      // El fan-out lo recoge el reloj de eventos; aquí solo se informa.
      void meetUrlChanged;
      void linkEmailsReset;

      await auditAgentWrite(ctx, {
        action: "UPDATE",
        entityType: "FreeWebinar",
        entityId: webinar.id,
        changes: input,
      });

      return {
        ok: true as const,
        webinar: {
          id: webinar.id,
          status: webinar.status,
          isActive: webinar.isActive,
          headline: webinar.headline,
          startsAtDate: webinar.startsAtDateKey,
          startsAtTime: webinar.startsAtTimeHm,
          startsAtHasTime: webinar.startsAtHasTime,
          operationalTimezone: webinar.operationalTimezone,
          link:
            webinar.status === "OPEN" && webinar.startsAt
              ? `${siteUrl()}${FREE_EVENT_PUBLIC_ROOT}`
              : null,
        },
        closedOtherEvents: closedOthers.map((o) => o.headline),
      };
    } catch (e) {
      if (e instanceof FreeEventLifecycleError) {
        return {
          ok: false as const,
          error: e.reason,
          message: FREE_EVENT_LIFECYCLE_MESSAGE[e.reason],
        };
      }
      if (e instanceof FreeWebinarMeetUrlError) {
        return {
          ok: false as const,
          error: "invalid_meet_url",
          message: "El enlace de la reunión debe ser una URL https válida.",
        };
      }
      if (e instanceof FreeWebinarPublishError) {
        return {
          ok: false as const,
          error: "not_publishable",
          blockers: e.blockers.map((b) => PUBLISH_BLOCKER_LABELS[b]),
          message: `No se puede publicar. Falta: ${e.blockers
            .map((b) => PUBLISH_BLOCKER_LABELS[b])
            .join(", ")}`,
        };
      }
      throw e;
    }
  },
});
