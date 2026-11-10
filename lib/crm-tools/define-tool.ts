import type { z } from "zod";
import type { AgentToolContext } from "./guard";

/**
 * The shape of a CRM tool. Local and tiny on purpose: the tools used to be
 * eve tools for the panel agent (removed 2026-11). The MCP server
 * (`lib/mcp/server.ts`) is now their only runtime caller, besides the e2e
 * scripts that call `execute` directly.
 *
 * `defineTool` is the identity function: it exists so each tool file keeps
 * its input type inferred from its zod schema.
 */

/** What the caller sees as the result, when it differs from what `execute` returns. */
export type ToolModelOutput = { type: "json"; value: unknown } | { type: "text"; value: string };

/**
 * Marks a tool that reaches people outside the CRM or changes something that
 * matters. Informational: nothing pauses on it. The MCP server gates these
 * tools by scope (`edit` / `execute` in `catalog.ts`, see `lib/mcp/scopes.ts`),
 * audits every call and tells the client through `destructiveHint` /
 * `readOnlyHint`, so a client that wants a human in the loop asks there.
 * `catalog.test.ts` checks that every edit/execute tool carries it.
 */
export type ToolApproval = { kind: "always" };

export const always = (): ToolApproval => ({ kind: "always" });

/** Identity of the caller plus what one call carries. */
export type ToolContext = AgentToolContext & {
  abortSignal: AbortSignal;
  callId: string;
  toolName: string;
};

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  description: string;
  inputSchema: z.ZodType<TInput>;
  approval?: ToolApproval;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput> | TOutput;
  toModelOutput?: (output: TOutput) => ToolModelOutput | Promise<ToolModelOutput>;
};

export const defineTool = <TSchema extends z.ZodType, TOutput>(definition: {
  description: string;
  inputSchema: TSchema;
  approval?: ToolApproval;
  execute(input: z.output<TSchema>, ctx: ToolContext): Promise<TOutput> | TOutput;
  toModelOutput?: (output: TOutput) => ToolModelOutput | Promise<ToolModelOutput>;
}): ToolDefinition<z.output<TSchema>, TOutput> =>
  definition as unknown as ToolDefinition<z.output<TSchema>, TOutput>;
