/**
 * «Pendientes» de WhatsApp. Contra la base de DESARROLLO, WhatsApp en modo
 * prueba (no sale nada) y un calendario simulado (no se llama a Google).
 *
 *   bun scripts/whatsapp-pending-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Un mensaje de la persona deja el chat pendiente (y 1 sin leer).
 * 2. Contestar desde el CRM lo deja leído pero sigue pendiente.
 * 3. Contestar desde el celular (eco) también: leído y pendiente.
 * 4. La IA, un recordatorio o un masivo no lo dan por leído.
 * 5. «Marcar como atendido» lo saca de la cola; un mensaje nuevo lo reabre.
 * 6. Una cita nueva en el calendario lo resuelve; si escribe después, no.
 * 7. Confirmar la cita o un pago lo resuelve.
 * 8. El historial importado nunca deja nada pendiente.
 * 9. Buscar dentro de «Te toca» no se sale de «Te toca».
 */
import { prisma } from "@/lib/db";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { ingestMessage } from "@/lib/meta/ingest";
import { sendMetaMessage } from "@/lib/meta/send";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { confirmAppointment, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { approveProposal, proposeForApproval } from "@/lib/crm/whatsapp-agent/approvals";
import { pendingWhere, reopenConversation, resolveConversations } from "@/lib/crm/whatsapp-agent/pending";
import { getChat, listChats, queueCounts } from "@/lib/crm/whatsapp-agent/workspace";
import { lastInboundSeen } from "@/lib/crm/whatsapp-pending-rules";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const A = "573000009301"; // el chat principal
const B = "573000009302"; // escribe después de que se creó la cita
const H = "573000009303"; // solo historial
const P = "573000009304"; // pago
const S1 = "573000009305"; // búsqueda: escalado
const S2 = "573000009306"; // búsqueda: no escalado
const THREADS = [A, B, H, P, S1, S2];

let seq = 0;
const msg = (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId,
  externalMessageId: `wamid.pending.${run}.${++seq}`,
  isEcho: false,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: `Pendiente ${threadId.slice(-2)}`,
  ...extra,
});

const inbound = async (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}) => {
  const r = await ingestMessage(msg(threadId, body, extra));
  if (r.outcome !== "stored") throw new Error(`no se guardó: ${JSON.stringify(r)}`);
  return r.conversationId;
};

const conv = (id: string) =>
  prisma.conversation.findUniqueOrThrow({
    where: { id },
    select: { unreadCount: true, resolvedAt: true, resolvedReason: true, resolvedById: true, draftBody: true },
  });
const itemIn = async (queue: "pending" | "attention" | "all", id: string, q?: string) =>
  (await listChats({ queue, q, take: 600 })).find((i) => i.id === id) ?? null;

/**
 * El contador global de «Pendientes» y cuántos de esos son de otros chats. La
 * base de desarrollo es compartida (otras pruebas escriben a la vez): lo que
 * se compara es el cambio del contador menos el cambio ajeno.
 */
const pendingCounts = async () => {
  const [total, others] = await Promise.all([
    queueCounts().then((c) => c.pending),
    prisma.conversation.count({
      where: { channel: "WHATSAPP", externalThreadId: { notIn: THREADS }, ...pendingWhere() },
    }),
  ]);
  return { total, others };
};
const ownDelta = (a: { total: number; others: number }, b: { total: number; others: number }) =>
  b.total - a.total - (b.others - a.others);

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: `pending-e2e-` } } });
};

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  // Sin IA durante la prueba.
  const prevAi = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "false" },
    update: { value: "false" },
  });
  await cleanup();
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER" }, select: { id: true } });

  try {
    console.log("\n1. La persona escribe → pendiente");
    const before = await pendingCounts();
    const a = await inbound(A, "Hola, quisiera una cita");
    const a1 = await conv(a);
    check("1 sin leer", a1.unreadCount === 1, a1.unreadCount);
    const item1 = await itemIn("pending", a);
    check("aparece en «Pendientes»", Boolean(item1?.pending), item1);
    check("«Sin responder»", item1?.replyState === "unanswered", item1?.replyState);
    check("con la hora de su mensaje", Boolean(item1?.pendingSince), item1?.pendingSince);
    const afterInbound = await pendingCounts();
    check("el contador de pendientes sube", ownDelta(before, afterInbound) === 1, { before, after: afterInbound });

    console.log("\n2. Dayana contesta desde el CRM");
    await prisma.conversation.update({ where: { id: a }, data: { draftBody: "lo que estaba escribiendo", draftSource: "STAFF" } });
    await sendMetaMessage({ conversationId: a, body: "¡Hola! Claro, te ayudo.", staffUserId: staff.id });
    const a2 = await conv(a);
    check("queda leído (0 sin leer)", a2.unreadCount === 0, a2.unreadCount);
    check("consume el borrador", a2.draftBody === null, a2.draftBody);
    const item2 = await itemIn("pending", a);
    check("sigue pendiente (responder no lo resuelve)", Boolean(item2?.pending));
    check("«Respondiste»", item2?.replyState === "you", item2?.replyState);

    console.log("\n3. Dayana contesta desde el celular (eco)");
    await inbound(A, "¿Tienes el jueves?");
    check("entra otro mensaje: 1 sin leer", (await conv(a)).unreadCount === 1);
    await inbound(A, "Sí, el jueves a las 3", { isEcho: true });
    const a3 = await conv(a);
    check("el eco lo deja leído", a3.unreadCount === 0, a3.unreadCount);
    const item3 = await itemIn("pending", a);
    check("sigue pendiente", Boolean(item3?.pending));
    check("«Respondiste desde el celular»", item3?.replyState === "you_phone", item3?.replyState);
    // Avisos en desorden: un eco más viejo que el último mensaje de la persona
    // llega después y no puede borrar su no leído.
    const t2 = new Date();
    await inbound(A, "¿Y a qué hora exactamente?", { sentAt: t2 });
    await inbound(A, "Te escribo en un rato", { isEcho: true, sentAt: new Date(t2.getTime() - 60_000) });
    check("un eco viejo que llega tarde no borra el no leído", (await conv(a)).unreadCount === 1, (await conv(a)).unreadCount);
    // (Mismo instante que su mensaje: cuenta como posterior. Sin fechas futuras:
    // lo que sigue en la prueba tiene que quedar más nuevo que este eco.)
    await inbound(A, "A las 3 en punto", { isEcho: true, sentAt: t2 });
    check("un eco posterior sí lo deja leído", (await conv(a)).unreadCount === 0, (await conv(a)).unreadCount);

    console.log("\n4. La IA, recordatorios y masivos no lo dan por leído");
    await inbound(A, "Perfecto, ¿cuánto cuesta?");
    await prisma.conversation.update({ where: { id: a }, data: { draftBody: "borrador de Dayana", draftSource: "STAFF" } });
    await sendMetaMessage({ conversationId: a, body: "Te paso la información.", isAutoReply: true });
    const a4 = await conv(a);
    check("la IA no lo marca leído", a4.unreadCount === 1, a4.unreadCount);
    check("y no le borra el borrador a Dayana", a4.draftBody === "borrador de Dayana", a4.draftBody);
    check("«Respondió la IA»", (await itemIn("pending", a))?.replyState === "ai");
    await sendMetaMessage({ conversationId: a, body: "Recordatorio", isAutoReply: true, source: "recordatorio:e2e" });
    await sendMetaMessage({ conversationId: a, body: "Invitación al evento", staffUserId: staff.id, source: `bulk:e2e-${run}` });
    const a4b = await conv(a);
    check("recordatorio y masivo tampoco", a4b.unreadCount === 1, a4b.unreadCount);
    const item4 = await itemIn("pending", a);
    check("«Mensaje automático» (no es una respuesta)", item4?.replyState === "auto", item4?.replyState);
    check("el borrador se ve en la lista", item4?.draftPreview === "borrador de Dayana", item4?.draftPreview);

    console.log("\n5. Marcar como atendido / mensaje nuevo");
    const stale = new Date(Date.now() - 60 * 60_000);
    const notYet = await resolveConversations({ ids: [a] }, "manual", staff.id, { seenInboundAt: stale });
    check("si llegó algo que no vio, no se resuelve", notYet.length === 0, notYet);
    const c1 = await pendingCounts();
    const done = await resolveConversations({ ids: [a] }, "manual", staff.id);
    const c2 = await pendingCounts();
    check("se resuelve", done.length === 1 && done[0] === a, done);
    check("sale de «Pendientes»", !(await itemIn("pending", a)));
    check("el contador baja", ownDelta(c1, c2) === -1, { before: c1, after: c2 });
    const chatA = await getChat(a);
    check("el chat dice «atendido a mano»", chatA?.pending === false && chatA.resolvedReason === "manual", { pending: chatA?.pending, reason: chatA?.resolvedReason });
    check("queda quién lo marcó", (await conv(a)).resolvedById === staff.id);
    check("en «Todos» sigue, ya sin pendiente", (await itemIn("all", a))?.pending === false);
    const again = await resolveConversations({ ids: [a] }, "payment");
    check("resolver lo ya resuelto no cambia el motivo", again.length === 0 && (await conv(a)).resolvedReason === "manual");
    await inbound(A, "Una pregunta más");
    const a5 = await conv(a);
    check("un mensaje nuevo lo reabre", (await itemIn("pending", a))?.pending === true && a5.resolvedAt === null, a5);
    await resolveConversations({ ids: [a] }, "manual", staff.id);
    check("«Volver a pendiente»", (await reopenConversation(a)) && (await itemIn("pending", a))?.pending === true);

    console.log("\n6. Una cita nueva en el calendario");
    const b = await inbound(B, "Quiero agendar");
    const startsAt = new Date(Date.now() + 48 * 3600_000);
    const ev = (id: string, phone: string, start: Date, updated: Date): CalendarEvent => ({
      id: `pending-e2e-${run}-${id}`,
      summary: `Cita prueba +${phone}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 3600_000).toISOString() },
      updated: updated.toISOString(),
    });
    // B escribió DESPUÉS de que Dayana creó el evento: sigue pendiente.
    const events = [ev("a", A, startsAt, new Date()), ev("b", B, startsAt, new Date(Date.now() - 10 * 60_000))];
    const s1 = await syncAppointments({ events });
    const a6 = await conv(a);
    check("la cita deja el chat atendido «por cita»", a6.resolvedReason === "appointment" && !(await itemIn("pending", a)), { reason: a6.resolvedReason, s1 });
    check("si escribió después de crear la cita, sigue pendiente", (await itemIn("pending", b))?.pending === true);
    check("la pasada cuenta el chat resuelto", s1.resolved === 1, s1);
    await inbound(A, "Gracias, ¿llevo algo?");
    const s2 = await syncAppointments({ events });
    check("escribe otra vez: la siguiente pasada NO lo resuelve", (await itemIn("pending", a))?.pending === true && s2.resolved === 0, s2);
    const moved = new Date(startsAt.getTime() + 24 * 3600_000);
    const s3 = await syncAppointments({ events: [ev("a", A, moved, new Date()), events[1]] });
    check("si la cita se mueve, cuenta como atendido otra vez", s3.resolved === 1 && !(await itemIn("pending", a)), s3);

    console.log("\n7. Confirmar la cita / un pago");
    await inbound(A, "SÍ", { sentAt: new Date(Date.now() - 1000) });
    const appt = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: events[0].id } });
    // La IA carga la conversación hasta aquí y, mientras piensa, llega otra pregunta.
    const transcript = await prisma.conversationMessage.findMany({
      where: { conversationId: a },
      orderBy: { sentAt: "asc" },
      select: { direction: true, sentAt: true },
    });
    await inbound(A, "¿Y me mandas el enlace?");
    await confirmAppointment(appt.id, { seenInboundAt: lastInboundSeen(transcript, new Date()) });
    const a7 = await conv(a);
    check(
      "confirmar con una pregunta que la IA no leyó: sigue pendiente",
      (await itemIn("pending", a))?.pending === true && a7.resolvedReason === null,
      a7
    );
    await confirmAppointment(appt.id);
    check("confirmar la cita lo resuelve", (await conv(a)).resolvedReason === "appointment" && !(await itemIn("pending", a)));
    const p = await inbound(P, "Ya te hice la transferencia");
    const aiRun = await prisma.whatsAppAiRun.create({ data: { conversationId: p, status: "THINKING" } });
    await proposeForApproval({
      runId: aiRun.id,
      conversationId: p,
      name: "Pendiente 04",
      proposal: { kind: "payment_received", message: "¡Gracias! Ya lo vi, quedó confirmado.", reason: "Dice que pagó." },
    });
    check("antes de aprobar, pendiente", (await itemIn("pending", p))?.pending === true);
    await approveProposal({ runId: aiRun.id, conversationId: p, staffId: staff.id });
    const p1 = await conv(p);
    check("confirmar el pago lo resuelve «por pago»", p1.resolvedReason === "payment" && !(await itemIn("pending", p)), p1);
    check("y queda leído", p1.unreadCount === 0, p1.unreadCount);

    console.log("\n8. El historial nunca deja nada pendiente");
    const h = await inbound(H, "Hola (de hace meses)", { isHistory: true, sentAt: new Date(Date.now() - 90 * 24 * 3600_000) });
    const h1 = await conv(h);
    check("chat nuevo del historial: no pendiente", !(await itemIn("pending", h)) && h1.resolvedReason === "import" && h1.unreadCount === 0, h1);
    await inbound(H, "Otro de hace un rato", { isHistory: true, sentAt: new Date(Date.now() - 3600_000) });
    check("un mensaje del historial más nuevo tampoco", !(await itemIn("pending", h)));
    await resolveConversations({ ids: [a] }, "manual", staff.id); // A ya estaba atendido «por cita»: no cambia
    await inbound(A, "Mensaje viejo que llega por historial", { isHistory: true, sentAt: new Date() });
    const aH = await conv(a);
    check("en un chat atendido, el historial no lo reabre ni le cambia el motivo", !(await itemIn("pending", a)) && aH.resolvedReason === "appointment", aH);
    await inbound(H, "Ahora sí escribe en vivo");
    check("un mensaje en vivo después sí lo deja pendiente", (await itemIn("pending", h))?.pending === true);

    console.log("\n9. Buscar dentro de una cola");
    const token = `Busqueda${run}`;
    const s1c = await inbound(S1, "hola", { participantName: `${token} Uno` });
    const s2c = await inbound(S2, "hola", { participantName: `${token} Dos` });
    await prisma.conversation.update({
      where: { id: s1c },
      data: { aiPausedAt: new Date(), aiPausedReason: "escalation", escalationCategory: "booking", escalationSeverity: "normal" },
    });
    const inAttention = await listChats({ queue: "attention", q: token });
    check("en «Te toca» solo el escalado", inAttention.length === 1 && inAttention[0].id === s1c, inAttention.map((i) => i.name));
    const inAll = await listChats({ queue: "all", q: token });
    check("en «Todos», los dos", inAll.length === 2, inAll.map((i) => i.name));
    await resolveConversations({ ids: [s2c] }, "manual", staff.id);
    const inPending = await listChats({ queue: "pending", q: token });
    check("en «Pendientes», solo el que sigue pendiente", inPending.length === 1 && inPending[0].id === s1c, inPending.map((i) => i.name));
  } finally {
    await cleanup();
    if (prevAi) await prisma.siteSetting.update({ where: { key: prevAi.key }, data: { value: prevAi.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.autoreply.enabled" } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Pendientes OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
