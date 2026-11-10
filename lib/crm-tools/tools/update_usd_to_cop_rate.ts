import { defineTool } from "@/lib/crm-tools/define-tool";
import { always } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { setUsdToCopRateSetting } from "@/lib/crm/site-settings";
import { requireWriteStaff, auditAgentWrite } from "@/lib/crm-tools/guard";

export default defineTool({
  description:
    "Update the site-wide USD→COP exchange rate used to price everything for Colombian customers. Confirm the exact rate with the operator before calling — the public site picks it up within its normal cache window, not instantly.",
  inputSchema: z.object({
    rate: z.number().positive().describe("e.g. 3900 means 1 USD = 3900 COP"),
  }),
  approval: always(),
  async execute({ rate }, ctx) {
    requireWriteStaff(ctx);
    await setUsdToCopRateSetting(rate);
    await auditAgentWrite(ctx, {
      action: "UPDATE",
      entityType: "SiteSetting",
      entityId: "USD_TO_COP_RATE",
      changes: { rate },
    });
    return { rate };
  },
});
