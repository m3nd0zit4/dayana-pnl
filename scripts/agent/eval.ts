/**
 * Eval of the panel agents (router + specialists) against a local eval server.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-server.ts     # terminal 1
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval.ts [ids…] [--k 2] [--no-judge]
 *
 * Every case runs k times (default 2) in a fresh session with the case's agent
 * (`x-crm-agent`). A run passes when the code graders (`lib/agent-eval/graders.ts`:
 * tools called, exactly the expected approvals, no «¿confirmas?» before a
 * card, no raw ids…) and the judge (did it answer, correctly, briefly) both
 * pass. The case passes when every run passes. Exit 1 if any case fails.
 * Writes `.eve/agent-eval-report.json` with every run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { generateObject } from "ai";
import { Client } from "eve/client";
import { z } from "zod";
import { EVAL_CASES, type EvalCase } from "@/lib/agent-eval/cases";
import { gradeTurn, isApprovalGate, type Failure, type RecordedTurn } from "@/lib/agent-eval/graders";
import { geminiProvider } from "@/lib/ai/gemini";

if (new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname !== "/neondb_dev") {
  console.error("eval: solo contra /neondb_dev.");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const k = Number(flag("--k") ?? 2);
const useJudge = !args.includes("--no-judge");
const concurrency = Number(flag("--concurrency") ?? 3);
const ids = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && ["--k", "--concurrency"].includes(args[i - 1])));
const cases = ids.length ? EVAL_CASES.filter((c) => ids.some((id) => c.id.startsWith(id))) : EVAL_CASES;

const { token, url } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string; url: string };

type EveEvent = { type: string; data?: Record<string, unknown> };
type Request = {
  requestId: string;
  prompt?: string;
  options?: { id: string; label: string }[];
  action?: { toolName?: string; input?: unknown };
};

const TURN_TIMEOUT_MS = 180_000;

/** Sends one user turn and follows it through any approvals/questions. */
async function runTurn(
  session: ReturnType<Client["session"]>,
  say: string,
  respond: "approve" | "deny" | undefined,
  answer: string | undefined
): Promise<RecordedTurn> {
  const started = Date.now();
  const rec: RecordedTurn = { say, texts: [], tools: [], requests: [], status: "waiting", reply: "", ms: 0 };
  let payload: Parameters<typeof session.send>[0] = say;

  for (let round = 0; round < 6; round++) {
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
    const response = await session.send(
      typeof payload === "string" ? { message: payload, signal: abort.signal } : { ...payload, signal: abort.signal }
    );
    const pending: Request[] = [];
    try {
      for await (const raw of response) {
        const event = raw as EveEvent;
        if (event.type === "message.completed") {
          const text = String((event.data as { message?: string; text?: string })?.message ?? (event.data as { text?: string })?.text ?? "");
          if (text.trim()) rec.texts.push(text);
        } else if (event.type === "actions.requested") {
          for (const a of ((event.data?.actions ?? []) as { name?: string; toolName?: string; input?: unknown }[])) {
            rec.tools.push({ name: String(a.toolName ?? a.name), input: a.input });
          }
        } else if (event.type === "input.requested") {
          for (const r of (event.data?.requests ?? []) as Request[]) {
            const options = (r.options ?? []).map((o) => o.id);
            const approval = isApprovalGate(options);
            rec.requests.push({
              kind: approval ? "approval" : "question",
              tool: r.action?.toolName,
              prompt: r.prompt,
              options: approval ? options : (r.options ?? []).map((o) => o.label),
              afterText: rec.texts.length - 1,
            });
            pending.push(r);
          }
        } else if (event.type === "session.failed" || event.type === "turn.failed") {
          rec.status = "failed";
          rec.error = JSON.stringify(event.data).slice(0, 400);
        }
      }
    } finally {
      clearTimeout(deadline);
    }
    if (rec.status === "failed" || pending.length === 0) break;
    payload = {
      inputResponses: pending.map((r) => {
        const options = (r.options ?? []).map((o) => o.id);
        if (isApprovalGate(options)) return { requestId: r.requestId, optionId: respond ?? "deny" };
        if (answer) return { requestId: r.requestId, text: answer };
        return options.length ? { requestId: r.requestId, optionId: options[0] } : { requestId: r.requestId, text: "Sí" };
      }),
    };
  }
  rec.reply = rec.texts.at(-1) ?? "";
  rec.ms = Date.now() - started;
  return rec;
}

const verdictSchema = z.object({
  pass: z.boolean().describe("true solo si cumple el objetivo, con datos correctos y sin inventar"),
  problems: z.array(z.string().max(200)).max(4),
});

const respondOf = (c: EvalCase, say: string) =>
  c.turns.find((t) => t.say === say)?.respond === "approve" ? "aprobar" : "cancelar";

async function judge(c: EvalCase, turns: RecordedTurn[]) {
  const google = geminiProvider();
  const transcript = turns
    .map(
      (t) =>
        `OPERADORA: ${t.say}\nHERRAMIENTAS: ${t.tools.map((x) => x.name).join(", ") || "ninguna"}\nAPROBACIONES: ${
          t.requests.filter((r) => r.kind === "approval").map((r) => r.tool).join(", ") || "ninguna"
        }${t.requests.some((r) => r.kind === "approval") ? ` (la evaluadora respondió «${respondOf(c, t.say)}» a propósito)` : ""}\nASISTENTE (todo lo que escribió):\n${t.texts.join("\n---\n") || "(nada)"}`
    )
    .join("\n\n");
  const { object } = await generateObject({
    model: google(process.env.GEMINI_JUDGE_MODEL?.trim() || "gemini-3.5-flash"),
    schema: verdictSchema,
    prompt: `Eres el evaluador de un asistente interno de un CRM (negocio de terapias de Dayana Beltrán). La operadora es la dueña del negocio. Juzga la ÚLTIMA respuesta del asistente contra el objetivo. Criterios: cumple el objetivo; los datos salen de herramientas (no inventa); responde corto y directo en español; no pide confirmación en texto antes de una aprobación; no pega ids técnicos. Las tablas y gráficos los dibuja el panel aparte, así que no exijas que la respuesta repita todas las filas.\n\nOBJETIVO: ${c.goal}\n\n${transcript}`,
  });
  return object;
}

type RunResult = { case: string; run: number; pass: boolean; failures: Failure[]; judge?: { pass: boolean; problems: string[] }; turns: RecordedTurn[] };

async function runCase(c: EvalCase, run: number): Promise<RunResult> {
  const client = new Client({ host: url, auth: { bearer: token }, headers: { "x-crm-agent": c.agent } });
  const session = client.session();
  const turns: RecordedTurn[] = [];
  const failures: Failure[] = [];
  for (const t of c.turns) {
    const rec = await runTurn(session, t.say, t.respond, t.answer).catch(
      (e): RecordedTurn => ({ say: t.say, texts: [], tools: [], requests: [], status: "failed", error: String(e), reply: "", ms: 0 })
    );
    turns.push(rec);
    failures.push(...gradeTurn(rec, t.expect));
  }
  let verdict: RunResult["judge"];
  if (useJudge && failures.every((f) => f.check !== "run")) {
    verdict = await judge(c, turns).catch((e) => ({ pass: false, problems: [`juez falló: ${String(e).slice(0, 120)}`] }));
  }
  return { case: c.id, run, pass: failures.length === 0 && (verdict?.pass ?? true), failures, judge: verdict, turns };
}

const jobs = cases.flatMap((c) => Array.from({ length: k }, (_, run) => () => runCase(c, run)));
const results: RunResult[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const r = await job();
      results.push(r);
      const secs = (r.turns.reduce((n, t) => n + t.ms, 0) / 1000).toFixed(0);
      console.log(
        `${r.pass ? "✓" : "✗"} ${r.case} #${r.run + 1} (${secs}s) tools=[${r.turns.flatMap((t) => t.tools.map((x) => x.name)).join(",")}]` +
          (r.pass ? "" : `\n    ${[...r.failures.map((f) => `${f.check}: ${f.detail}`), ...(r.judge && !r.judge.pass ? r.judge.problems.map((p) => `juez: ${p}`) : [])].join("\n    ")}`)
      );
    }
  })
);

writeFileSync(".eve/agent-eval-report.json", JSON.stringify(results, null, 2));
const byCase = new Map<string, RunResult[]>();
for (const r of results) byCase.set(r.case, [...(byCase.get(r.case) ?? []), r]);
const failed = [...byCase].filter(([, rs]) => rs.some((r) => !r.pass));
console.log(`\n${byCase.size - failed.length}/${byCase.size} casos pasan (k=${k}, todas las corridas).`);
for (const [id, rs] of failed) console.log(`  ✗ ${id}: ${rs.filter((r) => r.pass).length}/${rs.length}`);
process.exit(failed.length ? 1 : 0);
