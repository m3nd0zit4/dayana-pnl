import { defineTool } from "eve/tools";
import { z } from "zod";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";
import { AGENT_ORDER } from "@/agent/lib/catalog";
import { AGENT_MESSAGE_MAX, startOwnerConversation } from "@/lib/crm/agent-messages";

export default defineTool({
  description:
    "Start a conversation with Dayana (the owner) that reaches her as a notification (bell + push); when she opens it, the agent panel opens on a new thread with your message as its first line and she answers there. Use it ONLY when she is not in this chat with you: when you run for an external agent (MCP), when a task you were given ends with a question only she can answer, or when the operator explicitly asks you to leave her a message or a reminder for later. Never use it to answer the person who is talking to you right now. One clear question or update per message, in Spanish, with the names and facts she needs to answer without looking anything up. `agent` = which specialist should continue the conversation when she replies.",
  inputSchema: z.object({
    title: z.string().min(3).max(120).describe("Línea corta para la notificación, p. ej. «¿Le doy otra hora a Laura?»"),
    message: z.string().min(5).max(AGENT_MESSAGE_MAX),
    agent: z.enum(AGENT_ORDER as [string, ...string[]]).optional().describe("Quién sigue la conversación. Por defecto: auto"),
  }),
  async execute({ title, message, agent }, ctx) {
    const staff = requireWriteStaff(ctx);
    const attributes = ctx.session.auth?.current?.attributes as { channel?: string; tokenId?: string } | undefined;
    const source = attributes?.channel === "mcp" ? `mcp:${attributes.tokenId ?? "?"}` : `tool:${staff.staffId}`;
    const result = await startOwnerConversation({
      agent: (agent ?? "auto") as (typeof AGENT_ORDER)[number],
      title,
      message,
      source,
    });
    await auditAgentWrite(
      ctx,
      { action: "MESSAGE_OWNER", entityType: "AgentMessage", entityId: result.key, changes: { title, agent: agent ?? "auto" } },
      { notify: false }
    );
    return { sent: Boolean(result.notificationId), opensAt: result.href };
  },
});
