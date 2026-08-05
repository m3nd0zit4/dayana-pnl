import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import {
  clearFreeWebinarSchedule,
  resetFreeWebinar,
  updateFreeWebinar,
} from "@/lib/crm/free-webinar";
import { requireWriteStaff, auditAgentWrite } from "@/agent/lib/guard";

export default defineTool({
  description:
    "Take down the free webinar landing. mode=deactivate hides the public page (404) and Enlaces CTA but keeps copy and schedule. mode=clear_schedule hides and clears the date/time. mode=reset restores default placeholder copy, clears the schedule, and deactivates — use when the operator wants to “eliminar” / start over. Does not delete the database row (there is only one webinar landing).",
  inputSchema: z.object({
    mode: z
      .enum(["deactivate", "clear_schedule", "reset"])
      .describe(
        "deactivate = hide only; clear_schedule = hide + remove date/time; reset = restore defaults"
      ),
  }),
  approval: always(),
  async execute({ mode }, ctx) {
    requireWriteStaff(ctx);

    const result =
      mode === "deactivate"
        ? await updateFreeWebinar({ isActive: false })
        : mode === "clear_schedule"
          ? await clearFreeWebinarSchedule()
          : await resetFreeWebinar();

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
        isActive: result.isActive,
        headline: result.headline,
        startsAtDate: result.startsAtDateKey,
        startsAtTime: result.startsAtTimeHm,
      },
    };
  },
});
