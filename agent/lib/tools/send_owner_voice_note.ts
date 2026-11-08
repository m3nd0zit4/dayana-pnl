import { defineTool } from "eve/tools";
import { z } from "zod";
import { auditAgentWrite, requireWriteStaff } from "@/agent/lib/guard";
import { sendOwnerVoiceNote, VOICE_NOTE_MAX_CHARS } from "@/lib/voice/owner-voice-note";

export default defineTool({
  description:
    "Send Dayana (the owner) a WhatsApp voice note on HER OWN personal phone, read aloud by a synthetic voice. Only to her: the number is fixed in settings, you never choose it. Use it when she asks («mándame un audio», «dímelo por nota de voz», «mándame eso a mi WhatsApp») or, if she enabled it, together with message_owner when you start a conversation on your own. Write the text the way you would SAY it: short spoken Spanish, no markdown, no links, no lists, no ids, under ~60 seconds of speech. It only arrives within 24 h of her last WhatsApp to the business number; if it fails, tell her the reason in one line.",
  inputSchema: z.object({
    text: z.string().trim().min(3).max(VOICE_NOTE_MAX_CHARS).describe("Lo que dice la nota, tal como se dice en voz alta"),
    proactive: z.boolean().optional().describe("true = you send it on your own initiative (respects her quiet hours); false/omitted = she asked for it"),
  }),
  async execute({ text, proactive }, ctx) {
    const staff = requireWriteStaff(ctx);
    const attributes = ctx.session.auth?.current?.attributes as { channel?: string; tokenId?: string } | undefined;
    const source = attributes?.channel === "mcp" ? `mcp:${attributes.tokenId ?? "?"}` : `tool:${staff.staffId}`;
    const result = await sendOwnerVoiceNote({ text, reason: proactive ? "proactive" : "request", source, staffUserId: staff.staffId });
    await auditAgentWrite(
      ctx,
      { action: "AGENT_VOICE_NOTE", entityType: "AgentVoiceNote", entityId: result.sent ? result.messageId : "none", changes: { sent: result.sent, chars: text.length } },
      { notify: false }
    );
    return result.sent
      ? { sent: true, seconds: Math.round(result.seconds), link: `/admin/whatsapp?conversation=${result.conversationId}` }
      : { sent: false, reason: result.detail };
  },
});
