import { defineDynamic, defineInstructions } from "eve/instructions";
import { instructionsFor } from "@/agent/lib/prompts";
import { agentMemoryPrompt } from "@/lib/crm/agent-memory";

export default defineDynamic({
  events: {
    "session.started": async () => {
      const memory = await agentMemoryPrompt("whatsapp").catch(() => null);
      return defineInstructions({
        markdown: [instructionsFor("whatsapp", "delegated"), memory].filter(Boolean).join("\n\n"),
      });
    },
  },
});
