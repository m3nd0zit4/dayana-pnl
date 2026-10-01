import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  clearFreeWebinarSchedule,
  resetFreeWebinar,
  updateFreeWebinar,
} from "@/lib/crm/free-webinar";
import { requireWriteStaff, auditAgentWrite, getCallerStaff } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Take down the CURRENT free event's landing. mode=deactivate closes registrations (the public page stops showing it and the Enlaces CTA disappears) but keeps copy and schedule; people already registered still get their reminders. mode=clear_schedule closes it and clears the date/time. mode=reset restores default placeholder copy, clears the schedule and leaves it as a draft — use when the operator wants to “eliminar” / start over. Never deletes the event or its registrants: each event is an edition with its own history in /admin/eventos.",
  inputSchema: z.object({
    mode: z
      .enum(["deactivate", "clear_schedule", "reset"])
      .describe(
        "deactivate = close registrations only; clear_schedule = close + remove date/time; reset = restore defaults as a draft"
      ),
  }),
  approval: always(),
  async execute({ mode }, ctx) {
    requireWriteStaff(ctx);
    const actor = { staffUserId: getCallerStaff(ctx).staffId };

    const result =
      mode === "deactivate"
        ? (await updateFreeWebinar({ isActive: false }, undefined, actor)).webinar
        : mode === "clear_schedule"
          ? await clearFreeWebinarSchedule(undefined, actor)
          : await resetFreeWebinar(undefined, actor);

    await auditAgentWrite(ctx, {
      action: mode === "reset" ? "DELETE" : "UPDATE",
      entityType: "FreeWebinar",
      entityId: result.id,
      changes: { mode },
    });

    return {
      ok: true as const,
      mode,
      webinar: {
        id: result.id,
        status: result.status,
        isActive: result.isActive,
        headline: result.headline,
        startsAtDate: result.startsAtDateKey,
        startsAtTime: result.startsAtTimeHm,
      },
    };
  },
});
