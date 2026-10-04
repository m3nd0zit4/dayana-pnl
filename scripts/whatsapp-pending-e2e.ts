/**
 * Quién contestó, los no leídos y lo que cierra «Te toca» desde fuera del chat
 * (una cita, un pago). Contra la base de DESARROLLO, WhatsApp en modo prueba
 * (no sale nada) y un calendario simulado (no se llama a Google). Lo demás de
 * «Te toca» está en `whatsapp-attention-e2e.ts`.
 *
 *   bun scripts/whatsapp-pending-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Un mensaje de la persona: 1 sin leer, «sin responder».
 * 2. Contestar desde el CRM: leído, borrador consumido, «Respondiste», y sale de «Te toca».
 * 3. Contestar desde el celular (eco): leído y «desde el celular»; un eco viejo no borra el no leído.
 * 4. La IA, un recordatorio o un masivo no lo dan por leído ni lo sacan de «Te toca».
 * 5. Una cita nueva en el calendario lo saca de «Te toca» («por cita»); si escribió después, no.
 * 6. Confirmar la cita o un pago lo saca (lo que la IA no leyó sigue tocando).
 * 7. El historial importado nunca abre nada.
 * 8. Buscar busca en todos los chats, esté en la pestaña que esté.
 */
import { prisma } from "@/lib/db";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { ingestMessage } from "@/lib/meta/ingest";
import { sendMetaMessage } from "@/lib/meta/send";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { confirmAppointment, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { approveProposal, proposeForApproval } from "@/lib/crm/whatsapp-agent/approvals";
import { attentionWhere, openAttention } from "@/lib/crm/whatsapp-agent/attention";
import { listChats, queueCounts } from "@/lib/crm/whatsapp-agent/workspace";
import { lastInboundSeen } from "@/lib/crm/whatsapp-attention-rules";

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
const S1 = "573000009305"; // búsqueda: le toca
const S2 = "573000009306"; // búsqueda: no le toca
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
  participantName: `Respuesta ${threadId.slice(-2)}`,
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
    select: {
      unreadCount: true,
      resolvedReason: true,
      draftBody: true,
      attentionAt: true,
      attentionReason: true,
      lastHumanReplyAt: true,
      lastInboundAt: true,
    },
  });
const itemIn = async (queue: "attention" | "all", id: string, q?: string) =>
  (await listChats({ queue, q, take: 600 })).find((i) => i.id === id) ?? null;
/** Le toca: lo abre a partir de su último mensaje. */
const open = async (id: string, reason: Parameters<typeof openAttention>[1] = "unanswered") => {
  const c = await conv(id);
  await openAttention(id, reason, c.lastInboundAt ?? new Date());
};

/**
 * El contador de «Te toca» y cuántos son de otros chats. La base de desarrollo
 * es compartida: se compara el cambio del contador menos el cambio ajeno.
 */
const attentionCounts = async () => {
  const [total, others] = await Promise.all([
    queueCounts().then((c) => c.attention),
    attentionWhere().then((w) => prisma.conversation.count({ where: { AND: [w, { externalThreadId: { notIn: THREADS } }] } })),
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
  await prisma.platformNotification.deleteMany({ where: { entityType: "Conversation", entityId: { in: ids } } });
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: `pending-e2e-` } } });
};

const main = async () => {
  const prevProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
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
    console.log("\n1. La persona escribe");
    const a = await inbound(A, "Hola, quisiera una cita");
    const a1 = await conv(a);
    check("1 sin leer", a1.unreadCount === 1, a1.unreadCount);
    check("«Sin responder»", (await itemIn("all", a))?.replyState === "unanswered");
    const before = await attentionCounts();
    await open(a);
    const afterOpen = await attentionCounts();
    check("si le toca, el contador sube", ownDelta(before, afterOpen) === 1, { before, afterOpen });

    console.log("\n2. Dayana contesta desde el CRM");
    await prisma.conversation.update({ where: { id: a }, data: { draftBody: "lo que estaba escribiendo", draftSource: "STAFF" } });
    await sendMetaMessage({ conversationId: a, body: "¡Hola! Claro, te ayudo.", staffUserId: staff.id });
    const a2 = await conv(a);
    check("queda leído (0 sin leer)", a2.unreadCount === 0, a2.unreadCount);
    check("consume el borrador", a2.draftBody === null, a2.draftBody);
    check("anota la respuesta humana", a2.lastHumanReplyAt !== null);
    check("sale de «Te toca»", a2.attentionAt === null && !(await itemIn("attention", a)), a2);
    check("el contador baja", ownDelta(afterOpen, await attentionCounts()) === -1);
    check("«Respondiste»", (await itemIn("all", a))?.replyState === "you");

    console.log("\n3. Dayana contesta desde el celular (eco)");
    await inbound(A, "¿Tienes el jueves?");
    check("entra otro mensaje: 1 sin leer", (await conv(a)).unreadCount === 1);
    await inbound(A, "Sí, el jueves a las 3", { isEcho: true });
    check("el eco lo deja leído", (await conv(a)).unreadCount === 0);
    check("«Respondiste desde el celular»", (await itemIn("all", a))?.replyState === "you_phone");
    // Avisos en desorden: un eco más viejo que el último mensaje de la persona
    // llega después y no puede borrar su no leído.
    const t2 = new Date();
    await inbound(A, "¿Y a qué hora exactamente?", { sentAt: t2 });
    await inbound(A, "Te escribo en un rato", { isEcho: true, sentAt: new Date(t2.getTime() - 60_000) });
    check("un eco viejo que llega tarde no borra el no leído", (await conv(a)).unreadCount === 1, (await conv(a)).unreadCount);
    await inbound(A, "A las 3 en punto", { isEcho: true, sentAt: t2 });
    check("un eco posterior sí lo deja leído", (await conv(a)).unreadCount === 0, (await conv(a)).unreadCount);

    console.log("\n4. La IA, recordatorios y masivos no lo dan por leído ni lo sacan de «Te toca»");
    await inbound(A, "Perfecto, ¿cuánto cuesta?");
    await open(a);
    await prisma.conversation.update({ where: { id: a }, data: { draftBody: "borrador de Dayana", draftSource: "STAFF" } });
    const humanBefore = (await conv(a)).lastHumanReplyAt;
    await sendMetaMessage({ conversationId: a, body: "Te paso la información.", isAutoReply: true });
    const a4 = await conv(a);
    check("la IA no lo marca leído", a4.unreadCount === 1, a4.unreadCount);
    check("y no le borra el borrador a Dayana", a4.draftBody === "borrador de Dayana", a4.draftBody);
    check("«La IA respondió»", (await itemIn("all", a))?.replyState === "ai");
    await sendMetaMessage({ conversationId: a, body: "Recordatorio", isAutoReply: true, source: "recordatorio:e2e" });
    await sendMetaMessage({ conversationId: a, body: "Invitación al evento", staffUserId: staff.id, source: `bulk:e2e-${run}` });
    await sendMetaMessage({ conversationId: a, body: "Recordatorio del evento", staffUserId: staff.id, source: "evento:e2e:24h" });
    const a4b = await conv(a);
    check("recordatorio, masivo y evento tampoco", a4b.unreadCount === 1, a4b.unreadCount);
    check("ninguno cuenta como respuesta suya", a4b.lastHumanReplyAt?.getTime() === humanBefore?.getTime());
    check("sigue en «Te toca»", a4b.attentionAt !== null && Boolean(await itemIn("attention", a)));
    const item4 = await itemIn("all", a);
    check("«Mensaje automático» (no es una respuesta)", item4?.replyState === "auto", item4?.replyState);
    check("el borrador se ve en la lista", item4?.draftPreview === "borrador de Dayana", item4?.draftPreview);

    console.log("\n5. Una cita nueva en el calendario");
    const b = await inbound(B, "Quiero agendar");
    await open(b, "booking");
    const startsAt = new Date(Date.now() + 48 * 3600_000);
    const ev = (id: string, phone: string, start: Date, updated: Date): CalendarEvent => ({
      id: `pending-e2e-${run}-${id}`,
      summary: `Cita prueba +${phone}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 3600_000).toISOString() },
      updated: updated.toISOString(),
    });
    // B escribió DESPUÉS de que Dayana creó el evento: le sigue tocando.
    const events = [ev("a", A, startsAt, new Date()), ev("b", B, startsAt, new Date(Date.now() - 10 * 60_000))];
    const s1 = await syncAppointments({ events });
    const a5 = await conv(a);
    check("la cita lo saca de «Te toca» («por cita»)", a5.attentionAt === null && a5.resolvedReason === "appointment", { a5, s1 });
    check("si escribió después de crear la cita, le sigue tocando", (await conv(b)).attentionAt !== null);
    await inbound(A, "Gracias, ¿llevo algo?");
    await open(a);
    const s2 = await syncAppointments({ events });
    check("escribe otra vez: la siguiente pasada NO lo saca", (await conv(a)).attentionAt !== null, s2);
    const moved = new Date(startsAt.getTime() + 24 * 3600_000);
    await syncAppointments({ events: [ev("a", A, moved, new Date()), events[1]] });
    check("si la cita se mueve, cuenta como atendido otra vez", (await conv(a)).attentionAt === null);

    console.log("\n6. Confirmar la cita / un pago");
    const si = new Date(Date.now() - 1000);
    await inbound(A, "SÍ", { sentAt: si });
    await open(a);
    const appt = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: events[0].id } });
    // La IA carga la conversación hasta aquí y, mientras piensa, llega otra pregunta.
    const transcript = await prisma.conversationMessage.findMany({
      where: { conversationId: a },
      orderBy: { sentAt: "asc" },
      select: { direction: true, sentAt: true },
    });
    await inbound(A, "¿Y me mandas el enlace?");
    await confirmAppointment(appt.id, { seenInboundAt: lastInboundSeen(transcript, new Date()) });
    const a6 = await conv(a);
    check(
      "confirmar con una pregunta que la IA no leyó: le sigue tocando (por esa pregunta)",
      a6.attentionAt !== null && a6.attentionAt.getTime() > si.getTime() && a6.attentionReason === "unanswered",
      a6
    );
    await confirmAppointment(appt.id);
    check("confirmar la cita lo saca", (await conv(a)).attentionAt === null);
    const p = await inbound(P, "Ya te hice la transferencia");
    const aiRun = await prisma.whatsAppAiRun.create({ data: { conversationId: p, status: "THINKING" } });
    await proposeForApproval({
      runId: aiRun.id,
      conversationId: p,
      name: "Respuesta 04",
      proposal: { kind: "payment_received", message: "¡Gracias! Ya lo vi, quedó confirmado.", reason: "Dice que pagó." },
    });
    check("una propuesta esperando: le toca", Boolean((await itemIn("attention", p))?.awaitingApproval));
    await approveProposal({ runId: aiRun.id, conversationId: p, staffId: staff.id });
    const p1 = await conv(p);
    check("confirmar el pago lo saca («por pago»)", p1.resolvedReason === "payment" && !(await itemIn("attention", p)), p1);
    check("y queda leído", p1.unreadCount === 0, p1.unreadCount);

    console.log("\n7. El historial nunca abre nada");
    const h = await inbound(H, "Hola (de hace meses)", { isHistory: true, sentAt: new Date(Date.now() - 90 * 24 * 3600_000) });
    const h1 = await conv(h);
    check("chat nuevo del historial: no le toca", h1.attentionAt === null && h1.resolvedReason === "import" && h1.unreadCount === 0, h1);
    await inbound(H, "Otro de hace un rato", { isHistory: true, sentAt: new Date(Date.now() - 3600_000) });
    check("un mensaje del historial más nuevo tampoco", (await conv(h)).attentionAt === null);

    console.log("\n8. Buscar busca en todos los chats");
    const token = `Busqueda${run}`;
    const s1c = await inbound(S1, "hola", { participantName: `${token} Uno` });
    const s2c = await inbound(S2, "hola", { participantName: `${token} Dos` });
    await open(s1c, "payment");
    const fromAttention = await listChats({ queue: "attention", q: token });
    check(
      "buscando desde «Te toca» aparecen los dos (la búsqueda no se queda en la pestaña)",
      fromAttention.length === 2 && fromAttention.some((i) => i.id === s2c),
      fromAttention.map((i) => i.name)
    );
    check("el que le toca dice su motivo", fromAttention.find((i) => i.id === s1c)?.attention?.reason === "payment");
    const onlyAttention = (await listChats({ queue: "attention", take: 600 })).filter((i) => i.name.startsWith(token));
    check("sin buscar, en «Te toca» solo el que le toca", onlyAttention.length === 1 && onlyAttention[0].id === s1c, onlyAttention.map((i) => i.name));
  } finally {
    await cleanup();
    if (prevAi) await prisma.siteSetting.update({ where: { key: prevAi.key }, data: { value: prevAi.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.autoreply.enabled" } });
    if (prevProvider) await prisma.siteSetting.update({ where: { key: prevProvider.key }, data: { value: prevProvider.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Respuestas y cierres OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
