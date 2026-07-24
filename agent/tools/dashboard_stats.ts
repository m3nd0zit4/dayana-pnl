import { defineTool } from "eve/tools";
import { z } from "zod";
import { getDashboardStats } from "@/lib/crm/dashboard-stats";

export default defineTool({
  description: "Get top-line dashboard numbers: leads, payments today, active therapies, contact count, pipeline breakdown.",
  inputSchema: z.object({}),
  async execute() {
    const { stats, pipeline } = await getDashboardStats();
    return { stats, pipeline };
  },
});
