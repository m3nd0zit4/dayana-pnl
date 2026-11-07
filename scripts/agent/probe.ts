/**
 * One message to a local eval server, printing every step. For debugging an
 * eval case by hand:
 *
 *   bun scripts/agent/probe.ts ventas "¿Cuánto vendimos este mes?"
 */
import { readFileSync } from "node:fs";
import { Client } from "eve/client";

const [agent = "auto", ...words] = process.argv.slice(2);
const text = words.join(" ") || "¿Qué puedes hacer?";
const { token, url } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string; url: string };

const client = new Client({ host: url, auth: { bearer: token }, headers: { "x-crm-agent": agent } });
const session = client.session();
const started = Date.now();
const response = await session.send(text);
for await (const event of response) {
  const e = event as { type: string; data?: Record<string, unknown> };
  const ms = ((Date.now() - started) / 1000).toFixed(1);
  if (e.type === "message.appended" || e.type === "reasoning.appended") continue;
  if (e.type === "actions.requested") {
    const actions = (e.data?.actions ?? []) as { name?: string; toolName?: string; input?: unknown }[];
    for (const a of actions) console.log(`${ms}s → ${a.name ?? a.toolName}`, JSON.stringify(a.input).slice(0, 200));
    continue;
  }
  if (e.type === "action.result") {
    console.log(`${ms}s ← ${JSON.stringify(e.data).slice(0, 300)}`);
    continue;
  }
  console.log(`${ms}s ${e.type}`, e.type === "input.requested" || e.type === "session.failed" ? JSON.stringify(e.data).slice(0, 600) : "");
}
const result = await response.result().catch(() => null);
console.log("\nREPLY:\n" + (result?.message ?? "(none)"));
