import { defineDynamic, defineTool } from "eve/tools";
import { isAgentId, toolsForAgent } from "@/agent/lib/catalog";
import { toolDefinition } from "@/agent/lib/registry";

/**
 * The root agent's CRM tools: only the ones `agent/lib/catalog.ts` lists for
 * the agent this thread was started with (router or one specialist). Fewer,
 * relevant tools is most of what makes a small model pick the right one.
 *
 * `execute` stays an inline arrow over the loop variable: eve's bundler turns
 * it into a durable step from the closure (`name`), which is what lets the
 * tool survive a replay. Approval is carried over from the definition and eve
 * re-registers it on replay, failing closed to «ask» if it cannot.
 */
export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      const raw = ctx.session.auth.initiator?.attributes?.agent ?? ctx.session.auth.current?.attributes?.agent;
      const agent = isAgentId(raw) ? raw : "auto";
      const tools: Record<string, ReturnType<typeof defineTool>> = {};
      for (const name of toolsForAgent(agent)) {
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
