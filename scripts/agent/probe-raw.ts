/**
 * One or more messages to a local eval server, printing every event in compact
 * form (debugging delegation and approvals). Approvals are always DENIED.
 *
 *   bun scripts/agent/probe-raw.ts auto "primer mensaje" ["segundo mensaje"…]
 */
import { readFileSync } from "node:fs";
import { Client } from "eve/client";

const [agent = "auto", ...messages] = process.argv.slice(2);
const { token, url } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string; url: string };
const client = new Client({ host: url, auth: { bearer: token }, headers: { "x-crm-agent": agent } });
const session = client.session();
const started = Date.now();

type Ev = { type: string; data?: Record<string, unknown> };
const short = (v: unknown, n = 260) => JSON.stringify(v)?.slice(0, n);

const run = async (input: Parameters<typeof session.send>[0]) => {
  const response = await session.send(input);
  const pending: { requestId: string }[] = [];
  for await (const event of response) {
    const e = event as Ev;
    const ms = ((Date.now() - started) / 1000).toFixed(1);
    if (e.type === "message.appended" || e.type === "reasoning.appended") continue;
    const d = e.data ?? {};
    const tag = `${ms}s ${e.type} turn=${String(d.turnId ?? "-")} step=${String(d.stepIndex ?? "-")}`;
    if (e.type === "input.requested") {
      const reqs = (d.requests ?? []) as { requestId: string; action?: { callId?: string; toolName?: string; name?: string } }[];
      for (const r of reqs) {
        console.log(`${tag} request=${r.requestId} call=${r.action?.callId} tool=${r.action?.toolName ?? r.action?.name}`);
        pending.push({ requestId: r.requestId });
      }
      console.log(`   keys ${Object.keys(d).join(",")} req-keys ${Object.keys(((d.requests as unknown[])?.[0] ?? {}) as object).join(",")}`); console.log(`   meta ${short((event as { meta?: unknown }).meta, 400)}`);
      continue;
    }
    console.log(`${tag} ${short(d)}`);
  }
  return pending;
};

void (async () => {
  for (const text of messages) {
    console.log(`\n=== send: ${text}`);
    let pending = await run(text);
    while (pending.length > 0) {
      console.log(`\n=== deny ${pending.map((p) => p.requestId).join(",")}`);
      pending = await run({ inputResponses: pending.map((p) => ({ requestId: p.requestId, optionId: "deny" })) } as never);
    }
  }
  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(0);
})();
