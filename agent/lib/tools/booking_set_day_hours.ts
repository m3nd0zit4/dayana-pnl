import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { auditAgentWrite, requireManageTeam } from "@/agent/lib/guard";
import { setBookingDayHours } from "@/lib/crm/whatsapp-agent/day-hours";

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

export default defineTool({
  description:
    "Set the hours the WhatsApp AI may offer, book or move free calls on ONE date («hoy solo de 5 a 7», «mañana solo en la mañana», «el sábado no agendes»): those hours replace that weekday's normal ones for that date only, in Colombia time (24 h). `ranges: []` closes the day; `remove: true` goes back to the normal hours. This is the ONLY way such an order reaches the AI's hours — never put it in instructions text. The result lists calls already booked that day outside the new hours: tell the operator (moving them is her decision). Dayana approves before it applies.",
  inputSchema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD, ya resuelta («hoy» → la fecha de hoy en Colombia)."),
    ranges: z.array(z.object({ from: hm, to: hm })).max(6).default([]).describe("Franjas en hora de Colombia, 24 h: 5 a 7 de la tarde = 17:00–19:00."),
    note: z.string().max(120).optional(),
    remove: z.boolean().optional(),
  }),
  approval: always(),
  async execute({ date, ranges, note, remove }, ctx) {
    requireManageTeam(ctx);
    const result = await setBookingDayHours({ date, ranges, note, remove });
    if (!result.ok) throw new Error(result.error);
    await auditAgentWrite(ctx, {
      action: "WHATSAPP_AI_CONFIG_UPDATED",
      entityType: "WhatsAppAiConfig",
      entityId: "whatsapp.ai",
      changes: { dateHours: { date, ranges: remove ? null : ranges, note } },
    });
    return result;
  },
});
