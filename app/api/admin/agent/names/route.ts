import { withStaff } from "@/lib/api/handler";
import { agentNames } from "@/lib/crm/agent-names";

/** `GET ?ids=a,b` → `{ names: { a: "Laura Gómez (+57…)" } }` for the approval card. */
export const GET = withStaff("read", async ({ req }) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return Response.json({ names: await agentNames(ids) });
});
