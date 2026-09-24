/**
 * Consistencia de estados y envíos. Contra la base de DESARROLLO, WhatsApp en
 * modo prueba (no sale nada).
 *
 *   bun scripts/whatsapp-consistency-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Acuses en desorden: el estado final es el más alto y hay historial.
 * 2. Un acuse que llega antes que el wamid se liga cuando el mensaje lo recibe.
 * 3. Un fallo después de «entregado» no lo tapa.
 * 4. Doble clic en «Aceptar»: sale un solo mensaje.
 * 5. El mismo envío con la misma clave no sale dos veces.
 * 6. México: un contacto +52… con chat 521… tiene la ventana abierta.
 * 7. Un destinatario masivo atascado en «enviando» se recupera sin duplicar.
 */
import { prisma } from "@/lib/db";
import { applyStatus, attachPendingStatuses } from "@/lib/meta/status";
import { sendMetaMessage } from "@/lib/meta/send";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { approveProposal } from "@/lib/crm/whatsapp-agent/approvals";
import { planForRecipient, recipientFromContact } from "@/lib/crm/whatsapp-outbound";
import { recoverStuck } from "@/lib/meta/recover";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const THREAD = "573000006701";

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: THREAD } });
  const conv = await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: THREAD,
      metaAccountId: "test-phone-id",
      participantName: "Consistencia",
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
    },
  });
  const staff = await prisma.staffUser.findFirstOrThrow({ select: { id: true } });
  const outbound = (wamid: string) =>
    prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "OUTBOUND", status: "SENT", statusRank: 1, externalMessageId: wamid, body: "hola", sentAt: new Date() },
    });

  console.log("\n1. Acuses en desorden");
  const w1 = `wamid.cons.${run}.1`;
  const m1 = await outbound(w1);
  for (const status of ["READ", "SENT", "DELIVERED"] as const) {
    await applyStatus({ wamid: w1, status, at: new Date() });
  }
  const r1 = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: m1.id } });
  check("queda «leído» aunque «entregado» llegó al final", r1.status === "READ", r1.status);
  check("tiene hora de entrega y de lectura", Boolean(r1.deliveredAt && r1.readAt));
  const hist = await prisma.messageStatusEvent.count({ where: { messageId: m1.id } });
  check("historial con los 3 estados (Info del mensaje)", hist === 3, hist);

  console.log("\n2. Acuse antes del wamid");
  const w2 = `wamid.cons.${run}.2`;
  const early = await applyStatus({ wamid: w2, status: "DELIVERED", at: new Date() });
  check("se guarda sin ligar (no se tira)", early.messageId === null);
  const m2 = await prisma.conversationMessage.create({
    data: { conversationId: conv.id, direction: "OUTBOUND", status: "QUEUED", body: "hola 2", sentAt: new Date() },
  });
  await prisma.conversationMessage.update({ where: { id: m2.id }, data: { externalMessageId: w2, status: "SENT", statusRank: 1 } });
  await attachPendingStatuses(m2.id, w2);
  const r2 = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: m2.id } });
  check("al conocer el wamid queda «entregado»", r2.status === "DELIVERED", r2.status);

  console.log("\n3. Fallo después de entregado");
  const w3 = `wamid.cons.${run}.3`;
  const m3 = await outbound(w3);
  await applyStatus({ wamid: w3, status: "DELIVERED", at: new Date() });
  await applyStatus({ wamid: w3, status: "FAILED", at: new Date(), failedReason: "x", failedCode: 131000 });
  const r3 = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: m3.id } });
  check("sigue «entregado»", r3.status === "DELIVERED", r3.status);

  console.log("\n4. Doble clic en «Aceptar»");
  const runRow = await prisma.whatsAppAiRun.create({
    data: {
      conversationId: conv.id,
      status: "AWAITING_APPROVAL",
      proposal: { kind: "reply", message: "Te espero mañana 💛" },
      finishedAt: new Date(),
    },
  });
  const before = await prisma.conversationMessage.count({ where: { conversationId: conv.id } });
  const results = await Promise.allSettled([
    approveProposal({ runId: runRow.id, conversationId: conv.id, staffId: staff.id }),
    approveProposal({ runId: runRow.id, conversationId: conv.id, staffId: staff.id }),
  ]);
  const after = await prisma.conversationMessage.count({ where: { conversationId: conv.id } });
  check("un clic envía, el otro se rechaza", results.filter((r) => r.status === "fulfilled").length === 1, results.map((r) => r.status));
  check("sale un solo mensaje", after - before === 1, after - before);
  const approved = await prisma.conversationMessage.findFirst({ where: { clientKey: `approval:${runRow.id}` } });
  check("marcado como de la IA en la misma escritura", approved?.isAutoReply === true, approved?.isAutoReply);

  console.log("\n5. Misma clave, un solo envío");
  const key = `e2e:${run}`;
  const a = await sendMetaMessage({ conversationId: conv.id, body: "una vez", clientKey: key });
  const b = await sendMetaMessage({ conversationId: conv.id, body: "una vez", clientKey: key });
  check("devuelve el mismo mensaje", a.messageId === b.messageId);

  console.log("\n6. México: 52 → 521");
  const mxPhone = "+529990007788";
  const mxThread = "5219990007788";
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: [mxThread, mxPhone.slice(1)] } } });
  const mx = await prisma.contact.upsert({
    where: { phoneE164: mxPhone },
    create: { phoneE164: mxPhone, firstName: "Mx", countryIso: "MX", notifyWhatsapp: true },
    update: { notifyWhatsapp: true },
  });
  await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: mxThread, metaAccountId: "test-phone-id", contactId: mx.id, lastInboundAt: new Date(), lastMessageAt: new Date() },
  });
  const plan = await planForRecipient((await recipientFromContact(mx.id))!, null);
  check("escribió hace poco → texto libre (ventana abierta)", plan.action === "text", plan);

  console.log("\n7. Destinatario masivo atascado");
  const send = await prisma.whatsAppSend.create({
    data: { title: "e2e", kind: "libre", text: "hola", status: "SENDING", total: 1, createdById: staff.id },
  });
  const rec = await prisma.whatsAppSendRecipient.create({
    data: { sendId: send.id, contactId: mx.id, phone: mxPhone, name: "Mx", status: "SENDING", processedAt: new Date(Date.now() - 10 * 60_000) },
  });
  await recoverStuck();
  const back = await prisma.whatsAppSendRecipient.findUniqueOrThrow({ where: { id: rec.id } });
  check("vuelve a la cola para reintentarse", back.status === "PENDING", back.status);

  console.log("\n8. Un ✓✓ se ve en vivo y los chats largos se cargan por páginas");
  const { workspaceSnapshot, getChat, getOlderMessages, CHAT_PAGE } = await import("@/lib/crm/whatsapp-agent/workspace");
  const before8 = await workspaceSnapshot();
  await new Promise((r) => setTimeout(r, 1100));
  await applyStatus({ wamid: w3, status: "READ", at: new Date() });
  const after8 = await workspaceSnapshot();
  check("un cambio de estado cambia la versión de la pantalla", after8.latestAt > before8.latestAt, { before8, after8 });
  const LONG = "573000006702";
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: LONG } });
  const longConv = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: LONG, metaAccountId: "test-phone-id", lastMessageAt: new Date() },
  });
  const t0 = Date.now() - 200 * 60_000;
  await prisma.conversationMessage.createMany({
    data: Array.from({ length: CHAT_PAGE + 30 }, (_, i) => ({
      conversationId: longConv.id,
      direction: i % 2 ? "OUTBOUND" : "INBOUND",
      status: i % 2 ? "SENT" : "RECEIVED",
      body: `mensaje ${i}`,
      sentAt: new Date(t0 + i * 60_000),
    })) as never,
  });
  const long = (await getChat(longConv.id))!;
  check(`el chat abre con los últimos ${CHAT_PAGE} y avisa que hay más`, long.messages.length === CHAT_PAGE && long.hasMore === true, { n: long.messages.length, more: long.hasMore });
  check("en orden, el último abajo", long.messages.at(-1)?.body === `mensaje ${CHAT_PAGE + 29}`, long.messages.at(-1)?.body);
  const page = await getOlderMessages(longConv.id, new Date(long.messages[0].sentAt));
  check("«Cargar anteriores» trae los 30 que faltaban", page.messages.length === 30 && !page.hasMore && page.messages[0].body === "mensaje 0", { n: page.messages.length, first: page.messages[0]?.body });

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Consistencia OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
