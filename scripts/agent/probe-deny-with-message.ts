/**
 * Does eve take a new message and the «deny» of a pending approval in ONE
 * send? (8-nov: the owner typed a correction while a WhatsApp send waited for
 * approval; eve held her text until the card was answered and nothing came
 * back.) Never approves anything.
 *
 *   bun scripts/agent/probe-deny-with-message.ts
 */
import { readFileSync } from "node:fs";
import { Client } from "eve/client";

const { token, url } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string; url: string };
const client = new Client({ host: url, auth: { bearer: token }, headers: { "x-crm-agent": "whatsapp" } });
const session = client.session();

type Ev = { type: string; data?: Record<string, unknown> };

const run = async (input: Parameters<typeof session.send>[0]) => {
  const res = await session.send(input);
  const pending: string[] = [];
  let text = "";
  const tools: string[] = [];
  for await (const event of res) {
    const e = event as Ev;
    if (e.type === "input.requested") for (const r of (e.data?.requests ?? []) as { requestId: string; action?: { toolName?: string; input?: unknown } }[]) {
      pending.push(r.requestId);
      console.log(`  approval asked: ${r.action?.toolName} ${JSON.stringify(r.action?.input).slice(0, 220)}`);
    }
    if (e.type === "actions.requested") for (const a of (e.data?.actions ?? []) as { toolName?: string }[]) tools.push(String(a.toolName));
    if (e.type === "message.completed") text = String(e.data?.message ?? "");
  }
  console.log(`  tools: ${tools.join(", ")}`);
  console.log(`  reply: ${text.slice(0, 300)}`);
  return pending;
};

void (async () => {
  console.log("1) ask for a send");
  const pending = await run("Escríbele por WhatsApp a Valentina Prueba Eval que Dayana puede llamarla hoy a las 4:15 p. m. de Colombia.");
  if (pending.length === 0) {
    console.log("no approval was asked; nothing to test");
    process.exit(0);
  }
  console.log("2) new message + deny in the same send");
  const again = await run({
    message: "Está bien, pero no la saludes otra vez, ya la saludamos. Redáctalo de nuevo así y envíalo.",
    inputResponses: pending.map((requestId) => ({ requestId, optionId: "deny" })),
  } as never);
  console.log(`3) a new approval came back: ${again.length > 0}`);
  if (again.length) await run({ inputResponses: again.map((requestId) => ({ requestId, optionId: "deny" })) } as never);
  process.exit(0);
})();
