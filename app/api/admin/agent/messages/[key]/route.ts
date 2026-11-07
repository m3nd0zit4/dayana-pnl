import { apiError, withStaff } from "@/lib/api/handler";
import { getAgentMessageSeed } from "@/lib/crm/agent-messages";

/**
 * The message the panel assistant started a conversation with, for the panel
 * to open it (`/admin?agentMessage=<key>`). Only for someone who received it.
 */
export const GET = withStaff<{ key: string }>("read", async ({ staff, params }) => {
  const seed = await getAgentMessageSeed(params.key, staff.id);
  if (!seed) return apiError("not_found", 404);
  return Response.json({ seed });
});
