/**
 * End to end, on neondb_dev, of what the owner asked the panel agent to do
 * (2026-11-07), checking the database and not only what the model says:
 *
 * A. Teach the WhatsApp AI how to answer ONE chat → the instruction is saved
 *    for that chat, and the WhatsApp AI's reply in that chat follows it while
 *    a control chat with the same question does not.
 * B. «Mándale un WhatsApp a …» → one approval, then the message is in her chat
 *    (dry-run: WhatsApp sends are simulated in dev, checked before starting).
 * C. The agent starts a conversation with Dayana → an AGENT_MESSAGE
 *    notification she can open, with the agent's message behind it.
 * D. The morning brief (when switched on) does the same with what is waiting.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-server.ts    # other terminal
 *   bun --env-file=../dayana-pnl/.env scripts/agent/feature-e2e.ts [--k 2]
 */
import { readFileSync } from "node:fs";
import { Client } from "eve/client";
import { prisma } from "@/lib/db";
import { AGENT_BRIEF_SETTING, getAgentMessageSeed, sendMorningBrief } from "@/lib/crm/agent-messages";
import { getSiteSetting, setSiteSetting, deleteSiteSetting } from "@/lib/crm/site-settings";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { draftAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { getChatInstructions } from "@/lib/crm/whatsapp-agent/chat-instructions";
import { getMemory } from "@/lib/crm/whatsapp-agent/memory";
import { resolveDryRun } from "@/lib/notifications/platform/resolve";

if (new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname !== "/neondb_dev") {
  console.error("feature-e2e: solo contra /neondb_dev.");
  process.exit(1);
}
if (!(await resolveDryRun())) {
  console.error("feature-e2e: los envíos de WhatsApp NO están en simulación (dry-run). No arranco: la base de dev tiene la clave real.");
  process.exit(1);
}

// The shared .env pins a diagnostic model id; the WhatsApp AI drafts below run in this process.
process.env.GEMINI_MODEL = process.env.EVAL_GEMINI_MODEL ?? "gemini-3.5-flash";

const k = Number(process.argv[process.argv.indexOf("--k") + 1] || 1) || 1;
const OWNER = "staff_dev_owner";
const VALENTINA = "573005550199";
const CONTROL = "573005550198";
const { token, url } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string; url: string };

type Turn = { tools: { name: string; input: Record<string, unknown> }[]; approvals: string[]; texts: string[]; failed?: string };

/** One user turn; approves every card (the tests only reach dev data and simulated sends). */
async function say(agent: string, text: string): Promise<Turn> {
  const session = new Client({ host: url, auth: { bearer: token }, headers: { "x-crm-agent": agent } }).session();
  const turn: Turn = { tools: [], approvals: [], texts: [] };
  let payload: Parameters<typeof session.send>[0] = text;
  for (let round = 0; round < 6; round++) {
    const response = await session.send(payload);
    const pending: string[] = [];
    for await (const raw of response) {
      const e = raw as { type: string; data?: Record<string, unknown> };
      if (e.type === "actions.requested") {
        for (const a of (e.data?.actions ?? []) as { name?: string; toolName?: string; input?: Record<string, unknown> }[]) {
          turn.tools.push({ name: String(a.toolName ?? a.name), input: a.input ?? {} });
        }
      } else if (e.type === "input.requested") {
        for (const r of (e.data?.requests ?? []) as { requestId: string; action?: { toolName?: string }; options?: { id: string }[] }[]) {
          turn.approvals.push(r.action?.toolName ?? "?");
          pending.push(r.requestId);
        }
      } else if (e.type === "message.completed") {
        const t = String((e.data as { message?: string })?.message ?? "");
        if (t.trim()) turn.texts.push(t);
      } else if (e.type === "session.failed") {
        turn.failed = JSON.stringify(e.data).slice(0, 300);
      }
    }
    if (turn.failed || pending.length === 0) break;
    payload = { inputResponses: pending.map((requestId) => ({ requestId, optionId: "approve" })) };
  }
  return turn;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const chatId = async (digits: string) =>
  (await prisma.conversation.findFirstOrThrow({ where: { externalThreadId: digits }, select: { id: true } })).id;

/** The WhatsApp AI's draft for the last message of a real chat, with its instruction and memory. */
async function aiReplyIn(conversationId: string, digits: string) {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { sentAt: "asc" },
    select: { direction: true, body: true, sentAt: true },
  });
  const lastIn = rows.map((r) => r.direction).lastIndexOf("INBOUND");
  const transcript = rows.slice(0, lastIn + 1).map((r) => ({
    direction: r.direction === "INBOUND" ? ("INBOUND" as const) : ("OUTBOUND" as const),
    body: r.body,
    sentAt: r.sentAt,
  }));
  const draft = await draftAutoReply({
    config: await getWhatsAppAiConfig(),
    transcript,
    name: null,
    memory: await getMemory(digits),
    chatInstructions: await getChatInstructions(conversationId),
  });
  return draft.message;
}

const started = new Date();
const valentina = await chatId(VALENTINA);
const control = await chatId(CONTROL);

for (let run = 1; run <= k; run++) {
  console.log(`\n── corrida ${run}/${k}`);
  await deleteSiteSetting(`whatsapp.ai.chat.${valentina}.instructions`);

  // A. Per-chat instruction, taught in plain words.
  const a = await say(
    "whatsapp",
    "En el chat de Valentina Prueba Eval: si pregunta por el precio de la terapia, dile que esta semana Dayana no tiene agenda y ofrécele el taller «Sana Tu Relación con el Dinero». Es solo para ese chat."
  );
  const setCall = a.tools.find((t) => t.name === "whatsapp_set_chat" && typeof t.input.instructions === "string");
  check("A1 usa whatsapp_set_chat con instrucciones", Boolean(setCall), a.failed ?? a.tools.map((t) => t.name).join(","));
  check("A2 una sola aprobación", a.approvals.filter((t) => t === "whatsapp_set_chat").length === 1, a.approvals.join(","));
  const stored = await getChatInstructions(valentina);
  check("A3 instrucción guardada solo en ese chat", Boolean(stored) && !(await getChatInstructions(control)), stored ?? "(nada)");
  check(
    "A4 no la guardó como regla general",
    !a.tools.some((t) => t.name === "whatsapp_save_playbook" || t.name === "memory"),
    a.tools.map((t) => t.name).join(",")
  );
  const withRule = await aiReplyIn(valentina, VALENTINA);
  const withoutRule = await aiReplyIn(control, CONTROL);
  check("A5 la IA de WhatsApp sigue la instrucción en ese chat", /taller/i.test(withRule) && /agenda|esta semana/i.test(withRule), withRule.slice(0, 400));
  check("A6 el chat de control no la recibe", !/taller/i.test(withoutRule), withoutRule.slice(0, 400));

  // B. Send on request.
  const before = new Date();
  const b = await say(
    "whatsapp",
    "Mándale un WhatsApp a Valentina Prueba Eval diciéndole que esta semana no hay agenda disponible y que Dayana le escribe el lunes."
  );
  check("B1 usa send_whatsapp_to_contact", b.tools.some((t) => t.name === "send_whatsapp_to_contact"), b.failed ?? b.tools.map((t) => t.name).join(","));
  check("B2 una sola aprobación", b.approvals.filter((t) => t === "send_whatsapp_to_contact").length === 1, b.approvals.join(","));
  const sent = await prisma.conversationMessage.findFirst({
    where: { conversationId: valentina, direction: "OUTBOUND", sentAt: { gte: before } },
    orderBy: { sentAt: "desc" },
    select: { body: true },
  });
  check("B3 el mensaje quedó en su chat", Boolean(sent?.body && /agenda/i.test(sent.body) && !/\{\{/.test(sent.body)), sent?.body?.slice(0, 160) ?? "(nada)");

  // C. The agent starts a conversation with Dayana.
  const c = await say(
    "auto",
    "Déjale un mensaje a Dayana para que lo vea después: pregúntale si le damos a Valentina Prueba Eval un 10% de descuento en el taller."
  );
  const msgCall = c.tools.find((t) => t.name === "message_owner");
  check("C1 usa message_owner", Boolean(msgCall), c.failed ?? c.tools.map((t) => t.name).join(","));
  const note = await prisma.platformNotification.findFirst({
    where: { entityType: "AgentMessage", eventType: "AGENT_MESSAGE", createdAt: { gte: before }, recipients: { some: { staffUserId: OWNER } } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, href: true },
  });
  const seed = note?.entityId ? await getAgentMessageSeed(note.entityId, OWNER) : null;
  check("C2 notificación para Dayana que abre el panel", Boolean(note?.href?.startsWith("/admin?agentMessage=")), note?.href ?? "(nada)");
  check("C3 el mensaje del asistente está detrás", Boolean(seed && /descuento/i.test(seed.message)), seed?.message.slice(0, 160) ?? "(nada)");
}

// D. Morning brief, switched on just for this.
const previous = await getSiteSetting(AGENT_BRIEF_SETTING);
await setSiteSetting(AGENT_BRIEF_SETTING, "true");
const brief = await sendMorningBrief().catch((e) => ({ sent: false, reason: String(e) }));
if (previous === null) await deleteSiteSetting(AGENT_BRIEF_SETTING);
else await setSiteSetting(AGENT_BRIEF_SETTING, previous);
check("D1 resumen de la mañana enviado (si hay pendientes)", brief.sent || brief.reason === "nothing", JSON.stringify(brief));

// Leave dev as it was: the notifications this run created.
await prisma.platformNotification.deleteMany({ where: { eventType: "AGENT_MESSAGE", createdAt: { gte: started } } });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones pasan.`);
process.exit(failed.length ? 1 : 0);
