/**
 * «Te toca» de WhatsApp: entra lo que necesita a Dayana y sale en cuanto ella
 * contesta (CRM o celular) o pulsa «Listo». Contra la base de DESARROLLO,
 * WhatsApp en modo prueba (no sale nada) y la IA con una espera corta. Nada
 * de esto necesita que el modelo conteste (si Gemini falla, la IA escala y
 * eso también se acepta donde importa).
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-attention-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Escalada (tope del día) → «Te toca» + aviso y retira la propuesta vieja;
 *    Dayana contesta desde el CRM → sale, pausa humana, aviso leído.
 * 2. Escalada de pago y Dayana contesta desde el celular → sale, pero la IA
 *    sigue apartada (pago) hasta «Listo».
 * 3. Escalada clínica: un eco viejo no la saca; lo que escribió después de la
 *    respuesta sigue tocando; sigue apartada de la IA; «Listo» la devuelve.
 * 4. Carrera: Dayana contesta mientras la IA espera → la IA no hace nada.
 * 5. Copiloto: «gracias» no deja propuesta ni llama al modelo; tampoco tras un recordatorio.
 * 6. Copiloto: «ok» a unas horas ofrecidas SÍ se atiende (propuesta o «Te toca»).
 * 7. «Listo»: cierra, no cambia el modo, retira la propuesta, avisos leídos.
 * 8. Chat en modo Yo: un mensaje que importa abre «Te toca»; un «gracias» no.
 * 9. Aprobar: no cierra algo clínico; cubre solo lo que la IA leyó.
 * 10. Una cita no cierra un pago.
 * 11. Cancelar la propuesta deja el chat en «Te toca» si el mensaje importa.
 * 12. Una respuesta que WhatsApp no entregó no cuenta: vuelve a «Te toca».
 * 13. Una vuelta de la IA que se cortó: la reciente le toca a Dayana; la de hace días no.
 * 14. «Devolver a la IA» no levanta algo clínico o urgente (sí lo demás).
 * 15. Confirmar un pago devuelve el pago a la IA, nunca algo clínico.
 * 16. Una pausa a mano no es una escalada.
 * 17. Los contadores (pestaña, menú, pendientes del CRM) dicen lo mismo.
 * 18. La migración sobre filas de prueba (tablas temporales, se deshace).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/db";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { ingestMessage, processNormalizedEvent } from "@/lib/meta/ingest";
import { sendMetaMessage } from "@/lib/meta/send";
import { recoverStuck } from "@/lib/meta/recover";
import { applyStatus } from "@/lib/meta/status";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { getPendientes } from "@/lib/crm/pendientes";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { MANUAL_PAUSE_REASON } from "@/lib/crm/whatsapp-attention-rules";
import { pauseAutoReply, resumeAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { approveProposal, cancelProposal, proposeForApproval } from "@/lib/crm/whatsapp-agent/approvals";
import {
  attentionWhere,
  markAttended,
  openAttention,
  openAttentionIfNeedsReply,
} from "@/lib/crm/whatsapp-agent/attention";
import { resolveConversations } from "@/lib/crm/whatsapp-agent/pending";
import { getChat, listChats, queueCounts } from "@/lib/crm/whatsapp-agent/workspace";
import { emitPlatformNotification } from "@/lib/notifications/platform/emit";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
// La IA espera menos a que la persona termine de escribir (se lee al cargar `run.ts`, que es perezoso).
process.env.WHATSAPP_AI_DEBOUNCE_MS ??= "2500";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const run = Date.now();
const T = {
  cap: "573000009401",
  echo: "573000009402",
  late: "573000009403",
  race: "573000009404",
  thanks: "573000009405",
  listo: "573000009406",
  manual: "573000009407",
  reminder: "573000009408",
  slots: "573000009409",
  approveClinical: "573000009410",
  approveRead: "573000009411",
  apptPay: "573000009412",
  cancel: "573000009413",
  failed: "573000009414",
  stuckOld: "573000009415",
  stuckNew: "573000009416",
  resumeClinical: "573000009417",
  resumeUnknown: "573000009418",
  payOk: "573000009419",
  payClinical: "573000009420",
  manualPause: "573000009421",
};
const THREADS = Object.values(T);

let seq = 0;
const msg = (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId,
  externalMessageId: `wamid.attention.${run}.${++seq}`,
  isEcho: false,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: `Te toca ${threadId.slice(-2)}`,
  ...extra,
});

/** Guarda un mensaje sin despertar a la IA. */
const store = async (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}) => {
  const r = await ingestMessage(msg(threadId, body, extra));
  if (r.outcome !== "stored") throw new Error(`no se guardó: ${JSON.stringify(r)}`);
  return r.conversationId;
};
/** Como si llegara por el webhook: guarda y, si es de la persona, corre la IA. */
const arrive = (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}) =>
  processNormalizedEvent("whatsapp_business_account", msg(threadId, body, extra));
/** Un mensaje nuestro ya enviado (sin pasar por WhatsApp). */
const ours = (conversationId: string, body: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
  prisma.conversationMessage.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      status: "SENT",
      body,
      sentAt: new Date(Date.now() - minutesAgo * 60_000),
      ...extra,
    },
  });

const conv = (id: string) =>
  prisma.conversation.findUniqueOrThrow({
    where: { id },
    select: {
      aiMode: true,
      aiPausedReason: true,
      attentionAt: true,
      attentionReason: true,
      lastHumanReplyAt: true,
      lastInboundAt: true,
      resolvedReason: true,
      draftBody: true,
    },
  });
const inAttention = async (id: string) =>
  Boolean((await listChats({ queue: "attention", take: 600 })).find((i) => i.id === id));
const lastRun = (id: string) =>
  prisma.whatsAppAiRun.findFirst({ where: { conversationId: id }, orderBy: { queuedAt: "desc" } });
const awaiting = (id: string) => prisma.whatsAppAiRun.count({ where: { conversationId: id, status: "AWAITING_APPROVAL" } });
const notices = (id: string) =>
  prisma.notificationRecipient.findMany({
    where: { notification: { entityType: "Conversation", entityId: id } },
    select: { readAt: true, notification: { select: { eventType: true } } },
  });
/** Los avisos se emiten sin esperar (`fireNotification`): se espera a que aparezcan. */
const waitForNotice = async (id: string, ms = 15_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await notices(id)).length > 0) return true;
    await sleep(500);
  }
  return false;
};
/** Una escalada como la deja la IA: pausa, «Te toca» desde su mensaje y el aviso. */
const escalateByHand = async (id: string, category: string, staffId: string, severity = "normal") => {
  const c = await conv(id);
  await pauseAutoReply(id, "escalation", { category, severity, reason: `Prueba: ${category}` });
  await openAttention(id, category as Parameters<typeof openAttention>[1], c.lastInboundAt ?? new Date());
  await emitPlatformNotification({
    eventType: "WHATSAPP_AI_ESCALATED",
    title: `Prueba e2e: te toca (${category})`,
    entityType: "Conversation",
    entityId: id,
    staff: [staffId],
  });
};
/** Una propuesta como la deja la IA, pensada a partir de `startedAt`. */
const propose = async (id: string, proposal: Parameters<typeof proposeForApproval>[0]["proposal"], startedAt = new Date()) => {
  const aiRun = await prisma.whatsAppAiRun.create({
    data: { conversationId: id, status: "THINKING", queuedAt: startedAt, startedAt },
  });
  await proposeForApproval({ runId: aiRun.id, conversationId: id, name: "Prueba", proposal });
  return aiRun.id;
};

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.platformNotification.deleteMany({ where: { entityType: "Conversation", entityId: { in: ids } } });
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppMemory.deleteMany({ where: { phone: { in: THREADS } } });
  await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: "attention-e2e-" } } });
  await prisma.messageStatusEvent.deleteMany({ where: { wamid: { startsWith: "wamid.attention." } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
};

const main = async () => {
  const keys = ["whatsapp.provider", "whatsapp.autoreply.enabled", "whatsapp.ai"];
  const saved = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  // Una configuración conocida: IA para todos, siempre, sin saltarse a nadie.
  const base = await getWhatsAppAiConfig();
  await setWhatsAppAiConfig({
    ...base,
    defaultMode: "AUTO",
    schedule: { ...base.schedule, mode: "always" },
    audience: { skipKnownContacts: false, skipCustomers: false },
    notify: "OWNERS",
    handoffHours: 12,
    escalation: { holdingMessage: "En un momento te escribe Dayana." },
  });
  const config = await getWhatsAppAiConfig();
  const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  await cleanup();
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER", isActive: true }, select: { id: true } });

  try {
    console.log("\n1. Escalada y Dayana contesta desde el CRM");
    if (!hasKey) {
      console.log("  (omitida: sin GEMINI_API_KEY la IA no pasa el primer filtro)");
    } else {
      const c = await store(T.cap, "Hola", { sentAt: new Date(Date.now() - 2 * 3600_000) });
      // Ya respondió hoy todo lo que puede: la siguiente vez pasa el chat a Dayana.
      for (let i = 0; i < config.maxPerDay; i++) {
        await ours(c, `Respuesta automática ${i + 1}`, 90 - i, { isAutoReply: true });
      }
      // Una propuesta de antes: aprobarla no debe cerrar la escalada que viene.
      await propose(c, { kind: "reply", message: "Hola, ¿en qué te ayudo?" }, new Date(Date.now() - 60 * 60_000));
      await arrive(T.cap, "Necesito hablar con Dayana, es importante");
      const c1 = await conv(c);
      const r1 = await lastRun(c);
      check("la IA escala", r1?.status === "ESCALATED" && c1.aiPausedReason === "escalation", { status: r1?.status, reason: r1?.reason });
      check(
        "le toca desde el mensaje de la persona, por «no sabe qué responder»",
        c1.attentionAt?.getTime() === c1.lastInboundAt?.getTime() && c1.attentionReason === "unknown",
        c1
      );
      check("la propuesta vieja se retira", (await awaiting(c)) === 0);
      check("aparece en «Te toca»", await inAttention(c));
      check("se avisa en la campana", await waitForNotice(c));
      await sendMetaMessage({ conversationId: c, body: "Hola, aquí estoy. Cuéntame.", staffUserId: staff.id });
      const c2 = await conv(c);
      check("contestar desde el CRM la saca de «Te toca»", c2.attentionAt === null && !(await inAttention(c)), c2);
      check("la escalada pasa a pausa humana (la IA vuelve tras las horas de relevo)", c2.aiPausedReason === "human", c2.aiPausedReason);
      check("queda anotada la respuesta", c2.lastHumanReplyAt !== null);
      const n1 = await notices(c);
      check("el aviso queda leído", n1.length > 0 && n1.every((n) => n.readAt !== null), n1);
    }

    console.log("\n2. Escalada de pago y Dayana contesta desde el celular");
    {
      const c = await store(T.echo, "Ya hice el pago", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(c, "payment", staff.id);
      const item = (await listChats({ queue: "attention", take: 600 })).find((i) => i.id === c);
      check("en «Te toca» con su motivo", item?.attention?.reason === "payment", item?.attention);
      await arrive(T.echo, "¡Gracias! Ya lo vi, quedó confirmado.", { isEcho: true, participantName: null });
      const c1 = await conv(c);
      check("el eco la saca de «Te toca»", c1.attentionAt === null && !(await inAttention(c)), c1);
      check("pero un pago sigue apartado de la IA (hasta «Listo»)", c1.aiPausedReason === "escalation", c1.aiPausedReason);
      check("la cabecera dice «Ya contestaste»", (await getChat(c))?.escalation?.cause === "answered", (await getChat(c))?.escalation);
      const n = await notices(c);
      check("el aviso queda leído", n.length > 0 && n.every((x) => x.readAt !== null), n);
    }

    console.log("\n3. Escalada clínica y ecos en desorden");
    {
      const tA = new Date(Date.now() - 5 * 60_000);
      const c = await store(T.late, "Me siento muy mal hoy", { sentAt: tA });
      await escalateByHand(c, "clinical", staff.id);
      await arrive(T.late, "Te escribí ayer", { isEcho: true, participantName: null, sentAt: new Date(tA.getTime() - 60_000) });
      const c1 = await conv(c);
      check("un eco escrito ANTES de su mensaje no la saca", c1.attentionAt?.getTime() === tA.getTime() && c1.aiPausedReason === "escalation", c1);
      check("ni deja leído el aviso", (await notices(c)).some((n) => n.readAt === null));
      const tB = new Date(Date.now() - 60_000);
      await store(T.late, "¿Me puedes llamar hoy?", { sentAt: tB });
      // Contestó entre su primer mensaje y el segundo, y el eco llega tarde.
      await arrive(T.late, "Ay, lo siento mucho. Aquí estoy.", { isEcho: true, participantName: null, sentAt: new Date(Date.now() - 2 * 60_000) });
      const c2 = await conv(c);
      check(
        "lo que escribió después de la respuesta sigue tocando («sin responder», desde ese mensaje)",
        c2.attentionAt?.getTime() === tB.getTime() && c2.attentionReason === "unanswered",
        c2
      );
      check("algo clínico sigue apartado de la IA aunque ella contestó", c2.aiPausedReason === "escalation", c2.aiPausedReason);
      await arrive(T.late, "Te llamo en 5 minutos.", { isEcho: true, participantName: null });
      const c3 = await conv(c);
      check("contestar a eso la saca de «Te toca»", c3.attentionAt === null, c3);
      check("y la IA sigue apartada", c3.aiPausedReason === "escalation", c3.aiPausedReason);
      check("la cabecera ofrece «Listo» (hay escalada sin «Te toca»)", (await listChats({ queue: "all", q: T.late })).some((i) => i.escalation && !i.attention));
      const listo = await markAttended(c, staff.id, c3.lastInboundAt);
      const c4 = await conv(c);
      check("«Listo» la devuelve: pausa humana", listo === "ok" && c4.aiPausedReason === "human", { listo, c4 });
    }

    console.log("\n4. Dayana contesta mientras la IA espera");
    {
      const c = await store(T.race, "Hola", { sentAt: new Date(Date.now() - 3600_000) });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT" } });
      const pending = arrive(T.race, "Hola, ¿me ayudas a agendar una cita para el jueves? Es urgente.");
      await sleep(900);
      await sendMetaMessage({ conversationId: c, body: "¡Claro! Te escribo en un momento.", staffUserId: staff.id });
      await pending;
      await sleep(1500);
      const r = await lastRun(c);
      const c1 = await conv(c);
      check("la IA no hace nada («contestaste mientras la IA esperaba»)", r?.status === "SKIPPED" && r.reason === "replied_meanwhile", { status: r?.status, reason: r?.reason });
      check("sin propuesta", (await awaiting(c)) === 0);
      check("sin escalada ni «Te toca»", c1.attentionAt === null && c1.aiPausedReason !== "escalation", c1);
      check("sin borrador de la IA", c1.draftBody === null, c1.draftBody);
      check("sin aviso", (await notices(c)).length === 0);
    }

    console.log("\n5. Copiloto: «gracias» no deja propuesta (ni se llama al modelo)");
    if (!hasKey) {
      console.log("  (omitida: sin GEMINI_API_KEY la IA no pasa el primer filtro)");
    } else {
      const c = await store(T.thanks, "Hola, ¿cuánto dura una sesión?", { sentAt: new Date(Date.now() - 30 * 60_000) });
      await ours(c, "Hola, la sesión dura 60 minutos.", 29, { isAutoReply: true });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT" } });
      await arrive(T.thanks, "Muchas gracias 🙏");
      const r = await lastRun(c);
      const c1 = await conv(c);
      check("la IA no propone nada («no hacía falta responder»)", r?.status === "SKIPPED" && r.reason === "trivial", { status: r?.status, reason: r?.reason });
      check("sin llamar al modelo", r?.startedAt === null && r?.model === null, { startedAt: r?.startedAt, model: r?.model });
      check("sin propuesta ni «Te toca»", (await awaiting(c)) === 0 && c1.attentionAt === null && !(await inAttention(c)));
      check("sin borrador", c1.draftBody === null, c1.draftBody);

      // Tras un recordatorio de cita, un «gracias» tampoco pide nada.
      const m = await store(T.reminder, "Hola", { sentAt: new Date(Date.now() - 26 * 3600_000) });
      await ours(m, "¡Hola! Te agendé para mañana a las 3.", 25 * 60, { isAutoReply: true });
      await ours(m, "Hola, te recuerdo tu cita de mañana a las 3. ¿Me confirmas?", 20, {
        isAutoReply: true,
        source: "recordatorio:attention-e2e",
      });
      await prisma.conversation.update({ where: { id: m }, data: { aiMode: "COPILOT" } });
      await arrive(T.reminder, "Gracias 🙏");
      const rm = await lastRun(m);
      check("«gracias» tras un recordatorio: tampoco (y sin modelo)", rm?.reason === "trivial" && rm.model === null, { status: rm?.status, reason: rm?.reason });
    }

    console.log("\n6. Copiloto: «ok» a unas horas ofrecidas sí se atiende");
    if (!hasKey) {
      console.log("  (omitida: sin GEMINI_API_KEY la IA no pasa el primer filtro)");
    } else {
      const t0 = new Date(Date.now() - 20 * 60_000);
      const c = await store(T.slots, "Quiero agendar una sesión", { sentAt: t0 });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT", lastHumanReplyAt: t0 } });
      const sent = await ours(c, "Tengo estos espacios:\n• Jueves 3:00 p. m.\n• Viernes 10:00 a. m.", 15, {
        source: "approval",
        staffUserId: staff.id,
      });
      await prisma.whatsAppAiRun.create({
        data: {
          conversationId: c,
          status: "APPROVED",
          queuedAt: t0,
          startedAt: t0,
          decidedAt: new Date(Date.now() - 15 * 60_000),
          proposal: { kind: "slots", message: "Tengo estos espacios", sentMessageId: sent.id },
        },
      });
      await arrive(T.slots, "ok");
      await sleep(1000);
      const r = await lastRun(c);
      const c1 = await conv(c);
      const handled = (await awaiting(c)) > 0 || c1.attentionAt !== null;
      check(
        "no se descarta como trivial: la IA lo piensa (propuesta) o, si el modelo falla, le toca a Dayana",
        r?.reason !== "trivial" && handled,
        { status: r?.status, reason: r?.reason, awaiting: await awaiting(c), attention: c1.attentionReason }
      );
      if (r?.status === "ERROR") console.log("  (el modelo no contestó — Gemini 403 —: la IA escaló como «Falló la IA»)");
    }

    console.log("\n7. «Listo»");
    {
      const c = await store(T.listo, "Quiero saber si hay cupo este mes", { sentAt: new Date(Date.now() - 10 * 60_000) });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT" } });
      await escalateByHand(c, "other", staff.id);
      await propose(c, { kind: "reply", message: "Sí, hay cupo. ¿Te agendo?" });
      const seen = (await conv(c)).lastInboundAt!;
      const stale = await markAttended(c, staff.id, new Date(seen.getTime() - 60_000));
      check("si llegó algo que no se ve, no se cierra", stale === "new_message" && (await conv(c)).attentionAt !== null, stale);
      const ok = await markAttended(c, staff.id, seen);
      const c1 = await conv(c);
      check("«Listo» la saca de «Te toca»", ok === "ok" && c1.attentionAt === null && !(await inAttention(c)), { ok, c1 });
      check("no cambia el modo", c1.aiMode === "COPILOT", c1.aiMode);
      check("la escalada pasa a pausa humana", c1.aiPausedReason === "human", c1.aiPausedReason);
      check("retira la propuesta", (await awaiting(c)) === 0);
      check("queda como resuelto a mano", c1.resolvedReason === "manual", c1.resolvedReason);
      const n = await notices(c);
      check("los avisos del chat quedan leídos", n.length > 0 && n.every((x) => x.readAt !== null), n);
    }

    console.log("\n8. Chat en modo Yo");
    {
      const c = await store(T.manual, "Hola", { sentAt: new Date(Date.now() - 3600_000) });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "MANUAL" } });
      await arrive(T.manual, "¿Cuánto cuesta la sesión?");
      const c1 = await conv(c);
      check("la IA no contesta (modo Yo)", (await lastRun(c))?.reason === "manual");
      check("un mensaje que importa: le toca («sin responder»)", c1.attentionReason === "unanswered" && (await inAttention(c)), c1);
      await sendMetaMessage({ conversationId: c, body: "Te paso la información ahora.", staffUserId: staff.id });
      check("contesta: sale", (await conv(c)).attentionAt === null);
      await arrive(T.manual, "Gracias 🙏");
      check("un «gracias» no la vuelve a abrir", (await conv(c)).attentionAt === null);
      await arrive(T.manual, "Otra pregunta: ¿atiendes los sábados?");
      check("una pregunta nueva sí", (await conv(c)).attentionAt !== null && (await inAttention(c)));
    }

    console.log("\n9. Aprobar lo que propuso la IA");
    {
      // a) Autoevaluación urgente: aprobar el primer mensaje no cierra lo clínico.
      const a = await store(T.approveClinical, "Hola", { sentAt: new Date(Date.now() - 3 * 3600_000) });
      await escalateByHand(a, "clinical", staff.id, "urgent");
      const runA = await propose(a, { kind: "reply", message: "Hola, soy Dayana. Leí tu autoevaluación." });
      await approveProposal({ runId: runA, conversationId: a, staffId: staff.id });
      const a1 = await conv(a);
      check("aprobar no cierra una escalada clínica urgente", a1.attentionAt !== null && a1.attentionReason === "clinical", a1);
      check("sigue apartada de la IA", a1.aiPausedReason === "escalation", a1.aiPausedReason);
      check(
        "el aviso URGENTE sigue sin leer",
        (await notices(a)).some((n) => n.notification.eventType === "WHATSAPP_AI_ESCALATED" && n.readAt === null)
      );

      // b) La propuesta P1 se pensó con M1; M2 llegó después. Aprobar P1 no atiende M2.
      const t1 = new Date(Date.now() - 6 * 60_000);
      const b = await store(T.approveRead, "Hola, ¿cuánto dura la sesión?", { sentAt: t1 });
      await prisma.conversation.update({ where: { id: b }, data: { aiMode: "COPILOT" } });
      const runB = await propose(b, { kind: "reply", message: "La sesión dura 60 minutos." }, new Date(t1.getTime() + 30_000));
      const t2 = new Date(Date.now() - 2 * 60_000);
      await store(T.approveRead, "Y otra cosa: ¿atiendes en inglés?", { sentAt: t2 });
      await openAttentionIfNeedsReply(b);
      check("sin respuesta aún: le toca desde M1", (await conv(b)).attentionAt?.getTime() === t1.getTime());
      await approveProposal({ runId: runB, conversationId: b, staffId: staff.id });
      const b1 = await conv(b);
      check("aprobar P1 atiende M1, pero M2 sigue en «Te toca» (desde M2)", b1.attentionAt?.getTime() === t2.getTime() && b1.attentionReason === "unanswered", b1);
      check("la respuesta aprobada cubre hasta M1, no hasta el envío", b1.lastHumanReplyAt?.getTime() === t1.getTime(), b1.lastHumanReplyAt);
    }

    console.log("\n10. Una cita no cierra un pago");
    {
      const c = await store(T.apptPay, "Te mandé el comprobante", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(c, "payment", staff.id);
      const changed = await resolveConversations({ ids: [c] }, "appointment", null);
      const c1 = await conv(c);
      check("agendar no cierra un «pago»", c1.attentionAt !== null && c1.attentionReason === "payment", { changed, c1 });
      await resolveConversations({ ids: [c] }, "payment", staff.id);
      check("confirmar el pago sí", (await conv(c)).attentionAt === null);
      check("la cabecera dice que se resolvió con el pago", (await getChat(c))?.escalation?.cause === "payment", (await getChat(c))?.escalation);
    }

    console.log("\n11. Cancelar la propuesta");
    {
      const c = await store(T.cancel, "¿Tienes espacio el lunes en la mañana?", { sentAt: new Date(Date.now() - 4 * 60_000) });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT" } });
      const r = await propose(c, { kind: "reply", message: "Sí, el lunes a las 9." });
      check("con la propuesta, le toca", await inAttention(c));
      await cancelProposal({ runId: r, conversationId: c, staffId: staff.id });
      const c1 = await conv(c);
      check("cancelada, le sigue tocando: su mensaje no tiene respuesta", c1.attentionReason === "unanswered" && (await inAttention(c)), c1);
    }

    console.log("\n12. Una respuesta que WhatsApp no entregó");
    {
      const c = await store(T.failed, "¿Me pasas la dirección?", { sentAt: new Date(Date.now() - 4 * 60_000) });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "MANUAL" } });
      await openAttentionIfNeedsReply(c);
      const sent = await sendMetaMessage({ conversationId: c, body: "Claro, es la calle 10 # 20-30.", staffUserId: staff.id });
      check("contestó: sale de «Te toca»", (await conv(c)).attentionAt === null);
      const wamid = `wamid.attention.failed.${run}`;
      await prisma.conversationMessage.update({ where: { id: sent.messageId }, data: { externalMessageId: wamid } });
      await applyStatus({ wamid, status: "FAILED", at: new Date(), failedReason: "No se entregó (prueba)" });
      const c1 = await conv(c);
      check("WhatsApp avisa que no llegó: vuelve a «Te toca»", c1.attentionReason === "unanswered" && (await inAttention(c)), c1);
      check("y esa respuesta deja de contar", c1.lastHumanReplyAt === null, c1.lastHumanReplyAt);
    }

    console.log("\n13. Vueltas de la IA que se cortaron");
    {
      const o = await store(T.stuckOld, "¿Tienen sesiones en línea?", { sentAt: new Date(Date.now() - 50 * 3600_000) });
      const n = await store(T.stuckNew, "¿Tienen sesiones en línea?", { sentAt: new Date(Date.now() - 47 * 3600_000) });
      const old = await prisma.whatsAppAiRun.create({
        data: { conversationId: o, status: "THINKING", queuedAt: new Date(Date.now() - 49 * 3600_000) },
      });
      const recent = await prisma.whatsAppAiRun.create({
        data: { conversationId: n, status: "THINKING", queuedAt: new Date(Date.now() - 47 * 3600_000) },
      });
      await recoverStuck();
      const [oldAfter, recentAfter] = await Promise.all([
        prisma.whatsAppAiRun.findUniqueOrThrow({ where: { id: old.id } }),
        prisma.whatsAppAiRun.findUniqueOrThrow({ where: { id: recent.id } }),
      ]);
      check("una vuelta de hace más de 48 h no se toca (ni abre «Te toca»)", oldAfter.status === "THINKING" && (await conv(o)).attentionAt === null, oldAfter.status);
      check("una reciente se da por fallida y le toca a Dayana", recentAfter.status === "ERROR" && (await conv(n)).attentionReason === "unanswered", recentAfter.status);
    }

    console.log("\n14. Devolver a la IA / cambiar el modo");
    {
      const c = await store(T.resumeClinical, "No me siento bien", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(c, "clinical", staff.id, "urgent");
      const resumed = await resumeAutoReply(c);
      const c1 = await conv(c);
      check("algo clínico urgente no se devuelve a la IA sin «Listo»", !resumed && c1.aiPausedReason === "escalation", { resumed, c1 });
      check("sigue en «Te toca»", c1.attentionReason === "clinical" && (await inAttention(c)));
      check("con su aviso URGENTE sin leer", (await notices(c)).some((x) => x.readAt === null));

      const u = await store(T.resumeUnknown, "Una pregunta rara", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(u, "unknown", staff.id);
      const back = await resumeAutoReply(u);
      const u1 = await conv(u);
      check("«no sabe qué responder» sí vuelve a la IA y sale de «Te toca»", back && u1.aiPausedReason === null && u1.attentionAt === null, { back, u1 });
    }

    console.log("\n15. Confirmar un pago devuelve el pago a la IA, nunca algo clínico");
    {
      const p = await store(T.payOk, "Ya pagué", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(p, "payment", staff.id);
      const r = await propose(p, { kind: "payment_received", message: "¡Gracias! Quedó confirmado.", reason: "Dice que pagó." });
      await approveProposal({ runId: r, conversationId: p, staffId: staff.id });
      const p1 = await conv(p);
      check("confirmar el pago: sale de «Te toca» y la IA vuelve", p1.attentionAt === null && p1.aiPausedReason === null, p1);

      const k = await store(T.payClinical, "Ya pagué, pero me siento fatal", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(k, "clinical", staff.id, "urgent");
      const rk = await propose(k, { kind: "payment_received", message: "¡Gracias! Quedó confirmado.", reason: "Dice que pagó." });
      await approveProposal({ runId: rk, conversationId: k, staffId: staff.id });
      const k1 = await conv(k);
      check("con algo clínico urgente: sigue en pausa y en «Te toca»", k1.aiPausedReason === "escalation" && k1.attentionReason === "clinical", k1);
    }

    console.log("\n16. Una pausa a mano no es una escalada");
    {
      const c = await store(T.manualPause, "Hola", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await pauseAutoReply(c, "escalation", { category: "other", severity: "normal", reason: MANUAL_PAUSE_REASON });
      const chat = await getChat(c);
      check("no está en «Te toca»", !(await inAttention(c)));
      check("la cabecera dice «la pausaste tú»", chat?.escalation?.cause === "manual", chat?.escalation);
    }

    console.log("\n17. Los contadores dicen lo mismo");
    {
      const [counts, direct, list, pendientes] = await Promise.all([
        queueCounts(),
        attentionWhere().then((where) => prisma.conversation.count({ where })),
        listChats({ queue: "attention", take: 600 }),
        getPendientes(),
      ]);
      const todo = pendientes.find((p) => p.key === "whatsapp-te-toca")?.count ?? 0;
      check("pestaña = menú = consulta", counts.attention === direct, { counts: counts.attention, direct });
      check("la lista trae los mismos", list.length === Math.min(direct, 600), { list: list.length, direct });
      check("los pendientes del CRM cuentan lo mismo", todo === direct, { todo, direct });
    }

    console.log("\n18. La migración (tablas temporales, se deshace)");
    await checkBackfill();
  } finally {
    await cleanup();
    for (const key of keys) {
      const prev = saved.find((s) => s.key === key);
      if (prev) await prisma.siteSetting.update({ where: { key }, data: { value: prev.value } });
      else await prisma.siteSetting.deleteMany({ where: { key } });
    }
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ «Te toca» OK");
  process.exit(failures.length ? 1 : 0);
};

class Rollback extends Error {}

/**
 * Corre el SQL de la migración tal cual sobre copias temporales de las tablas
 * (en Postgres una tabla temporal tapa a la de `public` con el mismo nombre)
 * y lo deshace al final: la base no cambia.
 */
const checkBackfill = async () => {
  const sql = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20261013100000_whatsapp_attention/migration.sql"),
    "utf8"
  );
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
  const T0 = new Date(Date.now() - 24 * 3600_000);
  const at = (min: number) => new Date(T0.getTime() + min * 60_000);
  type Row = {
    id: string;
    attention_at: Date | null;
    attention_reason: string | null;
    ai_paused_reason: string | null;
    ai_paused_at: Date | null;
    last_human_reply_at: Date | null;
  };
  let rows: Row[] = [];
  let second: Row[] = [];
  const started = Date.now();
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE "conversations" (LIKE public."conversations" INCLUDING DEFAULTS) ON COMMIT DROP`);
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE "conversation_messages" (LIKE public."conversation_messages" INCLUDING DEFAULTS) ON COMMIT DROP`
        );
        // Sin las columnas nuevas, como en producción antes de migrar.
        await tx.$executeRawUnsafe(
          `ALTER TABLE pg_temp."conversations" DROP COLUMN IF EXISTS "attention_at", DROP COLUMN IF EXISTS "attention_reason", DROP COLUMN IF EXISTS "last_human_reply_at"`
        );
        const conv = (
          id: string,
          reason: string | null,
          pausedAt: Date | null,
          category: string | null,
          severity: string | null = "normal",
          escalationReason: string | null = "Prueba"
        ) =>
          tx.$executeRawUnsafe(
            `INSERT INTO pg_temp."conversations" (id, channel, external_thread_id, meta_account_id, ai_paused_reason, ai_paused_at, escalation_category, escalation_severity, escalation_reason, updated_at)
             VALUES ($1, 'WHATSAPP', $1, 'e2e', $2, $3, $4, $5, $6, now())`,
            id,
            reason,
            pausedAt,
            category,
            severity,
            escalationReason
          );
        let m = 0;
        const message = (
          conversationId: string,
          sentAt: Date,
          o: {
            inbound?: boolean;
            body?: string;
            auto?: boolean;
            echo?: boolean;
            source?: string | null;
            clientKey?: string | null;
            status?: string;
            kind?: string;
            attachments?: unknown;
            /** Salió sin nadie detrás (p. ej. el sticker que acompaña a una aprobación). */
            staffless?: boolean;
          } = {}
        ) =>
          tx.$executeRawUnsafe(
            `INSERT INTO pg_temp."conversation_messages" (id, conversation_id, direction, status, body, attachments, is_echo, is_auto_reply, source, client_key, kind, staff_user_id, sent_at)
             VALUES ($1, $2, $3::"MessageDirection", $4::"MessageDeliveryStatus", $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)`,
            `bf-msg-${++m}`,
            conversationId,
            o.inbound ? "INBOUND" : "OUTBOUND",
            o.status ?? (o.inbound ? "RECEIVED" : "SENT"),
            o.body ?? "x",
            o.attachments ? JSON.stringify(o.attachments) : null,
            Boolean(o.echo),
            Boolean(o.auto),
            o.source ?? null,
            o.clientKey ?? null,
            o.kind ?? "message",
            // Lo que se manda desde el CRM lleva a quien lo mandó.
            o.inbound || o.echo || o.staffless ? null : "staff-e2e",
            sentAt
          );

        // A: escalada sin respuesta → le sigue tocando, por «pago».
        await conv("bf-a", "escalation", at(0), "payment");
        // B: escalada clínica que Dayana contestó → sale de «Te toca», pero sigue apartada.
        await conv("bf-b", "escalation", at(0), "clinical");
        await message("bf-b", at(5));
        // C: «no sabe» y contestó desde el celular → sale y pasa a pausa humana.
        await conv("bf-c", "escalation", at(0), "unknown");
        await message("bf-c", at(5), { echo: true });
        // D: después solo hubo IA, masivo, recordatorio, saludo, un fallo y un
        //    aviso; antes, una respuesta suya vieja → le sigue tocando.
        await conv("bf-d", "escalation", at(0), "complaint");
        await message("bf-d", at(-60));
        await message("bf-d", at(1), { auto: true });
        await message("bf-d", at(2), { source: "bulk:x" });
        await message("bf-d", at(3), { auto: true, source: "recordatorio:x" });
        await message("bf-d", at(4), { auto: true, clientKey: "welcome:x" });
        await message("bf-d", at(5), { status: "FAILED" });
        await message("bf-d", at(6), { kind: "system" });
        // E: aprobó una propuesta de la IA → cuenta como respuesta suya.
        await conv("bf-e", "escalation", at(0), "booking");
        await message("bf-e", at(5), { auto: true, source: "approval" });
        // F: pausa sin categoría (la puso alguien en la bandeja general) → no
        //    es una escalada: fuera de «Te toca» y se queda como está.
        await conv("bf-f", "escalation", at(0), null, null, null);
        // G: sin escalada: solo se anota la última respuesta.
        await conv("bf-g", "human", at(0), null);
        await message("bf-g", at(5));
        // H: pago contestado → sigue apartado.  I: urgente contestado → sigue apartado.
        await conv("bf-h", "escalation", at(0), "payment");
        await message("bf-h", at(5));
        await conv("bf-i", "escalation", at(0), "other", "urgent");
        await message("bf-i", at(5));
        // J: contestó y la persona volvió a escribir algo que importa → le toca desde ahí.
        await conv("bf-j", "escalation", at(0), "unknown");
        await message("bf-j", at(5));
        await message("bf-j", at(8), { inbound: true, body: "Gracias 🙏" });
        await message("bf-j", at(9), { inbound: true, body: "¿Y el jueves puedes?" });
        // K: contestó y solo le dijeron «gracias» o un sticker → no le toca.
        await conv("bf-k", "escalation", at(0), "unknown");
        await message("bf-k", at(5));
        await message("bf-k", at(8), { inbound: true, body: "Muchas gracias ❤️" });
        await message("bf-k", at(9), { inbound: true, body: "", attachments: [{ kind: "sticker" }] });
        // L: lo único después fue algo sin nadie detrás (el sticker que acompaña
        //    a una aprobación) → no cuenta: le sigue tocando.
        await conv("bf-l", "escalation", at(0), "unknown");
        await message("bf-l", at(5), { staffless: true, attachments: [{ kind: "sticker" }], body: "" });
        // M: «Pausar» a mano y luego contestó → se queda como está (ni «Te toca» ni pausa humana).
        await conv("bf-m", "escalation", at(0), "other", "normal", "Pausado a mano.");
        await message("bf-m", at(5));

        const read = () =>
          tx.$queryRawUnsafe<Row[]>(
            `SELECT id, attention_at, attention_reason, ai_paused_reason, ai_paused_at, last_human_reply_at FROM pg_temp."conversations" ORDER BY id`
          );
        for (const s of statements) await tx.$executeRawUnsafe(s);
        rows = await read();
        // Otra pasada (el script de puesta al día, con el código nuevo ya
        // sirviendo): no cambia nada, salvo lo que pasó en el rato del
        // despliegue. Una aprobación que el código anotó hasta lo que leyó la
        // IA (antes del envío) no se adelanta; y Dayana contestó a D mientras
        // servía el código viejo (que no sabe de «Te toca»).
        await tx.$executeRawUnsafe(`UPDATE pg_temp."conversations" SET last_human_reply_at = $1 WHERE id = 'bf-e'`, at(3));
        await message("bf-d", at(20));
        for (const s of statements) await tx.$executeRawUnsafe(s);
        second = await read();
        throw new Rollback();
      },
      { timeout: 30_000 }
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  const row = (id: string) => rows.find((r) => r.id === id);
  const same = (d: Date | null | undefined, ref: Date) => Boolean(d) && new Date(d!).getTime() === ref.getTime();
  const recent = (d: Date | null | undefined) => Boolean(d) && new Date(d!).getTime() >= started - 60_000;
  check("A: escalada sin respuesta → le toca desde la escalada, por «payment»", same(row("bf-a")?.attention_at, at(0)) && row("bf-a")?.attention_reason === "payment" && row("bf-a")?.ai_paused_reason === "escalation", row("bf-a"));
  check("B: clínica contestada → sale de «Te toca» y sigue apartada", row("bf-b")?.attention_at === null && row("bf-b")?.ai_paused_reason === "escalation" && same(row("bf-b")?.last_human_reply_at, at(5)), row("bf-b"));
  check("C: contestó desde el celular → sale y pasa a pausa humana desde hoy", row("bf-c")?.attention_at === null && row("bf-c")?.ai_paused_reason === "human" && recent(row("bf-c")?.ai_paused_at), row("bf-c"));
  check("D: IA, masivo, recordatorio, saludo, fallo y aviso no cuentan", same(row("bf-d")?.attention_at, at(0)) && row("bf-d")?.ai_paused_reason === "escalation" && same(row("bf-d")?.last_human_reply_at, at(-60)), row("bf-d"));
  check("E: una propuesta aprobada cuenta como respuesta", row("bf-e")?.attention_at === null && row("bf-e")?.ai_paused_reason === "human", row("bf-e"));
  check("F: pausa sin categoría (a mano) → fuera de «Te toca», sigue igual", row("bf-f")?.attention_at === null && row("bf-f")?.ai_paused_reason === "escalation", row("bf-f"));
  check("L: algo enviado sin nadie detrás no cuenta como respuesta", same(row("bf-l")?.attention_at, at(0)) && row("bf-l")?.last_human_reply_at === null, row("bf-l"));
  check("M: una pausa a mano contestada se queda como está", row("bf-m")?.attention_at === null && row("bf-m")?.ai_paused_reason === "escalation" && same(row("bf-m")?.ai_paused_at, at(0)), row("bf-m"));
  check("G: sin escalada no le toca; se anota la respuesta", row("bf-g")?.attention_at === null && same(row("bf-g")?.last_human_reply_at, at(5)), row("bf-g"));
  check("H: pago contestado → sigue apartado", row("bf-h")?.attention_at === null && row("bf-h")?.ai_paused_reason === "escalation", row("bf-h"));
  check("I: urgente contestado → sigue apartado", row("bf-i")?.attention_at === null && row("bf-i")?.ai_paused_reason === "escalation", row("bf-i"));
  check("J: volvió a escribir algo que importa → le toca desde ahí («sin responder»)", same(row("bf-j")?.attention_at, at(9)) && row("bf-j")?.attention_reason === "unanswered" && row("bf-j")?.ai_paused_reason === "human", row("bf-j"));
  check("K: solo «gracias» o un sticker → no le toca", row("bf-k")?.attention_at === null && row("bf-k")?.ai_paused_reason === "human", row("bf-k"));
  const key = (r: Row | undefined) => JSON.stringify(r ?? null);
  const changed = rows
    .filter((r) => r.id !== "bf-e" && r.id !== "bf-d" && key(r) !== key(second.find((s) => s.id === r.id)))
    .map((r) => r.id);
  check("otra pasada no cambia nada", changed.length === 0 && second.length === rows.length, changed);
  const d2 = second.find((s) => s.id === "bf-d");
  check(
    "lo contestado en el rato del despliegue sale de «Te toca» al volver a pasar",
    d2?.attention_at === null && d2?.ai_paused_reason === "human" && same(d2?.last_human_reply_at, at(20)),
    d2
  );
  check(
    "otra pasada no adelanta lo que cubre una aprobación hasta su hora de envío",
    same(second.find((s) => s.id === "bf-e")?.last_human_reply_at, at(3)),
    second.find((s) => s.id === "bf-e")
  );
  const leftover = await prisma.conversation.count({ where: { id: { startsWith: "bf-" } } });
  check("la base real no cambió", leftover === 0, leftover);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
