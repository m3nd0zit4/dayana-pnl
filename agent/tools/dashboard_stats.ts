import { defineTool } from "eve/tools";
import { z } from "zod";
import { getDashboardStats } from "@/lib/crm/dashboard-stats";
import { requireStaff } from "@/agent/lib/guard";

export default defineTool({
  description: "Get top-line dashboard numbers: leads, payments today, active therapies, contact count, pipeline breakdown.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    requireStaff(ctx);
    const { stats, pipeline } = await getDashboardStats();
    return { stats, pipeline };
  },
});
