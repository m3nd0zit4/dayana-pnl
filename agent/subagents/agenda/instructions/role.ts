import { defineDynamic, defineInstructions } from "eve/instructions";
import { instructionsFor } from "@/agent/lib/prompts";
import { agentMemoryPrompt } from "@/lib/crm/agent-memory";

export default defineDynamic({
  events: {
    "session.started": async () => {
      const memory = await agentMemoryPrompt("agenda").catch(() => null);
      return defineInstructions({
        markdown: [instructionsFor("agenda", "delegated"), memory].filter(Boolean).join("\n\n"),
      });
    },
  },
});
