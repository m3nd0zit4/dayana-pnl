import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";
import { CALL_MESSAGE_MAX, placeOwnerCall } from "@/lib/voice/calls/owner-call";

export default defineTool({
  description:
    "Phone Dayana (the owner) on HER OWN personal phone: a synthetic voice says your message, listens to her spoken answer and brings it back to the agent panel as a new conversation (what she says on the phone never approves anything by itself). Only when she asks you to call her («llámame cuando…», «llámame ahora»), or for something that truly can't wait for a notification. Off unless the owner switched calls on in settings; may be a simulated call in testing. Write the message as spoken Spanish: one or two short sentences with the question, no markdown, no ids.",
  inputSchema: z.object({
    message: z.string().trim().min(5).max(CALL_MESSAGE_MAX).describe("Lo que le dices al contestar, en voz alta"),
    proactive: z.boolean().optional().describe("true = on your own initiative (respects her quiet hours)"),
  }),
  approval: always(),
  async execute({ message, proactive }, ctx) {
    const staff = requireWriteStaff(ctx);
    const attributes = ctx.session.auth?.current?.attributes as { channel?: string; tokenId?: string } | undefined;
    const source = attributes?.channel === "mcp" ? `mcp:${attributes.tokenId ?? "?"}` : `tool:${staff.staffId}`;
    const result = await placeOwnerCall({ message, reason: proactive ? "proactive" : "request", source, staffUserId: staff.staffId });
    await auditAgentWrite(
      ctx,
      { action: "AGENT_CALL", entityType: "AgentCall", entityId: result.placed ? result.callKey : "none", changes: { placed: result.placed } },
      { notify: false }
    );
    return result.placed
      ? { placed: true, simulated: result.simulated, provider: result.provider }
      : { placed: false, reason: result.detail };
  },
});
