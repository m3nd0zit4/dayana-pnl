import { defineDynamic, defineInstructions } from "eve/instructions";
import { isAgentId } from "@/agent/lib/catalog";
import { instructionsFor } from "@/agent/lib/prompts";
import { agentMemoryPrompt } from "@/lib/crm/agent-memory";

/**
 * The root agent plays the role the operator picked in the panel's agent menu
 * (`x-crm-agent` header → `attributes.agent`, see `agent/channels/eve.ts`).
 * Read from the session initiator so a thread keeps the agent it started
 * with. Memory is a frozen snapshot per conversation, like Hermes: edits show
 * up in the next one, and the prompt prefix stays cacheable.
 */
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const raw = ctx.session.auth.initiator?.attributes?.agent ?? ctx.session.auth.current?.attributes?.agent;
      const agent = isAgentId(raw) ? raw : "auto";
      const memory = await agentMemoryPrompt(agent).catch(() => null);
      return defineInstructions({
        markdown: [instructionsFor(agent, "root"), memory].filter(Boolean).join("\n\n"),
      });
    },
  },
});
