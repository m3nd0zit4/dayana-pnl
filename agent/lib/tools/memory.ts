import { defineTool } from "eve/tools";
import { z } from "zod";
import { auditAgentWrite, getCallerStaff, requireStaff, requireWriteStaff } from "@/agent/lib/guard";
import {
  AGENT_MEMORY_CAP,
  AGENT_MEMORY_SCOPES,
  addAgentMemory,
  listAgentMemories,
  removeAgentMemory,
  replaceAgentMemory,
} from "@/lib/crm/agent-memory";

export default defineTool({
  description:
    "Your long-term memory: rules, preferences and corrections the team gave you. Save when the operator says how they want something done from now on («de ahora en adelante…», «no vuelvas a…», «recuerda que…», «prefiero que…»), corrects a mistake of yours, or states a lasting fact about how the business works. Never save one-off data (a contact's phone, today's numbers): that lives in the CRM. One short rule per entry, in Spanish. scope: all (every agent) or the specialist it applies to (ventas, whatsapp, agenda, talleres, contactos). actions: list | add | replace (match = a fragment that identifies exactly one old entry) | remove. What you save applies from the next conversation; in this one, just follow it. Corrections about how the WhatsApp AI answers clients are NOT memory: those go to the WhatsApp AI's playbooks or configuration. After saving, say in one short line what you will remember.",
  inputSchema: z.object({
    action: z.enum(["list", "add", "replace", "remove"]),
    scope: z.enum(AGENT_MEMORY_SCOPES).optional().describe("Default all"),
    content: z.string().max(400).optional().describe("add / replace: the rule to remember"),
    match: z.string().max(200).optional().describe("replace / remove: fragment of exactly one entry"),
  }),
  async execute({ action, scope, content, match }, ctx) {
    const where = scope ?? "all";
    if (action === "list") {
      requireStaff(ctx);
      const entries = await listAgentMemories(scope ? [scope] : AGENT_MEMORY_SCOPES);
      return { entries: entries.map((e) => ({ scope: e.scope, content: e.content })), cap: AGENT_MEMORY_CAP };
    }
    requireWriteStaff(ctx);

    if (action === "add") {
      if (!content) return { ok: false, error: "Falta `content`." };
      const result = await addAgentMemory({ scope: where, content, staffUserId: getCallerStaff(ctx).staffId });
      if (!result.ok) return result;
      await auditAgentWrite(
        ctx,
        { action: "CREATE", entityType: "AgentMemory", entityId: result.entry.id, changes: { scope: where, content: result.entry.content } },
        { notify: false }
      );
      return { ok: true, saved: result.entry.content, scope: where, used: result.used, cap: result.cap };
    }

    if (!match) return { ok: false, error: "Falta `match`." };

    if (action === "replace") {
      if (!content) return { ok: false, error: "Falta `content`." };
      const result = await replaceAgentMemory({ scope: where, match, content });
      if (!result.ok) return result;
      await auditAgentWrite(
        ctx,
        { action: "UPDATE", entityType: "AgentMemory", entityId: result.entry.id, changes: { before: result.previous, after: result.entry.content } },
        { notify: false }
      );
      return { ok: true, saved: result.entry.content, replaced: result.previous, scope: where };
    }

    const result = await removeAgentMemory({ scope: where, match });
    if (!result.ok) return result;
    await auditAgentWrite(
      ctx,
      { action: "DELETE", entityType: "AgentMemory", entityId: result.id, changes: { removed: result.removed } },
      { notify: false }
    );
    return { ok: true, removed: result.removed, scope: where };
  },
});
