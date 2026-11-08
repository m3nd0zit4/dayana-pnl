import { withStaff } from "@/lib/api/handler";
import { listAgentThreads } from "@/lib/crm/agent-threads";

/** The signed-in staff member's assistant conversations (no events: see `[id]`). */
export const GET = withStaff("read", async ({ staff }) => Response.json({ threads: await listAgentThreads(staff.id) }));
