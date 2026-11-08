import { defineDynamic, defineTool } from "eve/tools";
import { toolsForAgent } from "@/agent/lib/catalog";
import { toolDefinition } from "@/agent/lib/registry";
import { plainJson } from "@/agent/lib/plain-json";

/** The «ventas» specialist's tools. Same pattern as `agent/tools/crm.ts`. */
export default defineDynamic({
  events: {
    "session.started": () => {
      const tools: Record<string, ReturnType<typeof defineTool>> = {};
      for (const name of toolsForAgent("ventas")) {
        const definition = toolDefinition(name);
        tools[name] = defineTool({
          description: definition.description,
          inputSchema: definition.inputSchema,
          approval: definition.approval,
          // Plain JSON only (a Date in a result failed the whole call); the
          // tool's own `toModelOutput` (what the model reads) is kept.
          execute: async (input, toolCtx) => plainJson(await toolDefinition(name).execute(input, toolCtx)),
          ...(definition.toModelOutput ? { toModelOutput: definition.toModelOutput } : {}),
        });
      }
      return tools;
    },
  },
});
