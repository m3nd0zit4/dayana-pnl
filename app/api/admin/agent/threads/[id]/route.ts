import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { deleteAgentThread, getAgentThread, saveAgentThread } from "@/lib/crm/agent-threads";

/**
 * One assistant conversation of the signed-in staff member. Any role: these
 * are their own chats. PUT is append-only (see `lib/crm/agent-threads.ts`):
 * 409 with the server copy's summary when the device holds fewer events.
 */

const ID = /^[A-Za-z0-9_-]{6,80}$/;

const saveSchema = z.object({
  agent: z.string().min(1).max(40),
  title: z.string().max(200),
  opener: z.unknown().optional(),
  session: z.unknown().optional(),
  events: z.array(z.unknown()).max(20_000),
});

export const GET = withStaff<{ id: string }>("read", async ({ staff, params }) => {
  if (!ID.test(params.id)) return apiError("not_found", 404);
  const thread = await getAgentThread(staff.id, params.id);
  return thread ? Response.json({ thread }) : apiError("not_found", 404);
});

export const PUT = withStaff<{ id: string }>("read", async ({ req, staff, params }) => {
  if (!ID.test(params.id)) return apiError("invalid_id", 400);
  const parsed = saveSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const result = await saveAgentThread(staff.id, params.id, parsed.data);
  if (result.ok) return Response.json({ thread: result.thread });
  if (result.reason === "stale") return Response.json({ error: "stale", thread: result.thread }, { status: 409 });
  if (result.reason === "too_large") return apiError("too_large", 413);
  return apiError("not_found", 404);
});

export const DELETE = withStaff<{ id: string }>("read", async ({ staff, params }) => {
  if (!ID.test(params.id)) return apiError("not_found", 404);
  await deleteAgentThread(staff.id, params.id);
  return new Response(null, { status: 204 });
});
