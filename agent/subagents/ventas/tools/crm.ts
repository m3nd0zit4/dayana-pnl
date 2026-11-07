import { defineDynamic, defineTool } from "eve/tools";
import { toolsForAgent } from "@/agent/lib/catalog";
import { toolDefinition } from "@/agent/lib/registry";

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
          execute: (input, toolCtx) => toolDefinition(name).execute(input, toolCtx),
        });
      }
      return tools;
    },
  },
});
