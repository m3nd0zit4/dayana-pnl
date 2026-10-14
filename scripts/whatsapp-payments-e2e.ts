/**
 * Pagos por WhatsApp, pausas y pendientes contra la base de DESARROLLO. Sin
 * llamar al modelo ni enviar nada.
 *
 *   bun scripts/whatsapp-payments-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Llega un comprobante: queda «por confirmar» (dos fotos seguidas = uno
 *    solo) y aparece en el chat. Dayana lo confirma: la persona queda como
 *    contacto (nombre y número), el chat vinculado y clienta.
 * 2. Quien solo recibió los datos de pago y dice «ya te transferí» sigue
 *    siendo atendida por la IA (no es clienta), por revisar.
 * 3. Con las pausas apagadas, que Dayana conteste no pausa; «Pausar» a mano sí.
 * 4. Pendientes: un chat donde la persona escribió y nadie contestó aparece;
 *    uno contestado o fuera de las 24 h no.
 * 5. El enlace de pago vivo que Dayana creó se encuentra; uno revocado no.
 */
import { prisma } from "@/lib/db";
import { MANUAL_PAUSE_REASON } from "@/lib/crm/whatsapp-attention-rules";
import { pauseAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { findUnansweredChats } from "@/lib/crm/whatsapp-agent/catch-up";
import { activePaymentLinkFor, decideReceipt, listReceipts, saveReceipt } from "@/lib/crm/whatsapp-agent/payments";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";
import { getChat } from "@/lib/crm/whatsapp-agent/workspace";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const PAYER = "573000007711";
const CLAIMS = "573000007712";
const PAUSE = "573000007713";
const PENDING = "573000007714";
const ANSWERED = "573000007715";
const OLD = "573000007716";
const THREADS = [PAYER, CLAIMS, PAUSE, PENDING, ANSWERED, OLD];

type Line = { dir: "INBOUND" | "OUTBOUND"; body: string | null; minutesAgo: number; attachments?: unknown };

const chat = async (thread: string, name: string, lines: Line[]) => {
  const lastIn = lines.filter((l) => l.dir === "INBOUND").at(-1);
  return prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: thread,
      metaAccountId: "e2e",
      participantName: name,
      status: "OPEN",
      lastMessageAt: new Date(Date.now() - Math.min(...lines.map((l) => l.minutesAgo)) * 60_000),
      lastInboundAt: lastIn ? new Date(Date.now() - lastIn.minutesAgo * 60_000) : null,
      messages: {
        create: lines.map((l, i) => ({
          direction: l.dir,
          status: "DELIVERED" as const,
          externalMessageId: `wamid.e2e.pay.${thread}.${i}`,
          body: l.body,
          attachments: l.attachments ?? undefined,
          sentAt: new Date(Date.now() - l.minutesAgo * 60_000),
        })),
      },
    },
    include: { messages: { orderBy: { sentAt: "desc" } } },
  });
};

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppPaymentReceipt.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.contactChannelIdentity.deleteMany({ where: { externalId: { in: THREADS } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  const contacts = await prisma.contact.findMany({ where: { phoneE164: { in: THREADS.map((t) => `+${t}`) } }, select: { id: true } });
  await prisma.paymentLink.deleteMany({ where: { contactId: { in: contacts.map((c) => c.id) } } });
  await prisma.contact.deleteMany({ where: { id: { in: contacts.map((c) => c.id) } } });
};

const main = async () => {
  await cleanup();
  const staff = await prisma.staffUser.findFirst({ where: { role: "OWNER", isActive: true }, select: { id: true } });
  if (!staff) throw new Error("Falta un OWNER en la base de desarrollo.");

  console.log("1. Comprobante → por confirmar → Dayana confirma");
  const payer = await chat(PAYER, "Laura Gómez", [
    { dir: "INBOUND", body: "Hola, quiero pagar la sesión", minutesAgo: 30 },
    { dir: "OUTBOUND", body: "Claro, te comparto los datos para el pago:", minutesAgo: 29 },
    { dir: "INBOUND", body: null, minutesAgo: 2, attachments: [{ kind: "image", url: null, mediaId: "123456789", mimeType: "image/jpeg", caption: null }] },
  ]);
  const photo = payer.messages[0];
  const first = await saveReceipt({
    conversationId: payer.id,
    contactId: null,
    messageId: photo.id,
    method: "Bancolombia",
    amount: 150000,
    currency: "COP",
    summary: "Transferencia Bancolombia a Julian Mendoza",
    confirmMessage: "Gracias, Laura. Dayana confirmó tu pago.",
  });
  const second = await saveReceipt({ conversationId: payer.id, contactId: null, messageId: photo.id, reference: "TRX-9981", summary: "Otra foto del mismo pago" });
  check("dos fotos seguidas del mismo pago son un solo comprobante", first.id === second.id && second.reference === "TRX-9981");
  check("el monto queda en pesos enteros", second.amountMinor === 150000 && second.currency === "COP", second);
  const view = await getChat(payer.id);
  check("el chat muestra el comprobante por confirmar", view?.receipts.length === 1 && view.receipts[0].attachment?.kind === "image", view?.receipts);
  const decided = await decideReceipt({ receiptId: first.id, decision: "confirm", staffUserId: staff.id, message: "" });
  const contact = decided.contactId ? await prisma.contact.findUnique({ where: { id: decided.contactId } }) : null;
  check("al confirmar se crea el contacto con su nombre y número", contact?.phoneE164 === `+${PAYER}` && contact.firstName === "Laura" && contact.lastName === "Gómez", contact);
  const linked = await prisma.conversation.findUnique({ where: { id: payer.id }, select: { contactId: true, category: true, categorySource: true } });
  check("el chat queda vinculado y marcado clienta a mano", linked?.contactId === decided.contactId && linked?.category === "cliente" && linked.categorySource === "manual", linked);
  const seg = await computeSegment(payer.id);
  check("ya es clienta (la IA deja de atenderla)", seg?.segment === "client", seg);
  check("no queda nada por confirmar", (await listReceipts(payer.id)).every((r) => r.status !== "pending"));
  let twice = false;
  await decideReceipt({ receiptId: first.id, decision: "reject", staffUserId: staff.id }).catch(() => (twice = true));
  check("un comprobante ya decidido no se vuelve a decidir", twice);

  console.log("2. Recibió los datos y dice que pagó: la IA sigue, por revisar");
  const claims = await chat(CLAIMS, "Marta", [
    { dir: "INBOUND", body: "Hola, ¿cómo pago?", minutesAgo: 60 },
    { dir: "OUTBOUND", body: "Hola Marta, te comparto el enlace de pago: https://www.dayanabeltran.com/pagar/abc", minutesAgo: 59 },
    { dir: "INBOUND", body: "Listo, ya te transferí", minutesAgo: 5 },
  ]);
  const claimSeg = await computeSegment(claims.id);
  check("no es clienta: sigue con la IA y queda por revisar", claimSeg?.segment !== "client" && claimSeg?.review === true, claimSeg);

  console.log("3. Pausas");
  const paused = await chat(PAUSE, "Pausa", [{ dir: "INBOUND", body: "Hola", minutesAgo: 3 }]);
  check("que Dayana conteste no pausa (pausas apagadas)", (await pauseAutoReply(paused.id)) === false);
  check("una escalada de pago no pausa", (await pauseAutoReply(paused.id, "escalation", { category: "payment", severity: "normal", reason: "Comprobante" })) === false);
  check("una crisis sí pausa", (await pauseAutoReply(paused.id, "escalation", { category: "clinical", severity: "urgent", reason: "Crisis" })) === true);
  await prisma.conversation.update({ where: { id: paused.id }, data: { aiPausedAt: null, aiPausedReason: null } });
  check("«Pausar» a mano sí pausa", (await pauseAutoReply(paused.id, "escalation", { category: "other", severity: "normal", reason: MANUAL_PAUSE_REASON })) === true);
  await prisma.conversation.update({ where: { id: paused.id }, data: { aiPausedAt: null, aiPausedReason: null, escalationCategory: null, escalationReason: null, escalationSeverity: null } });

  console.log("4. Pendientes");
  await chat(PENDING, "Sin respuesta", [{ dir: "INBOUND", body: "¿Cuándo es la próxima llamada?", minutesAgo: 40 }]);
  await chat(ANSWERED, "Contestada", [
    { dir: "INBOUND", body: "Hola", minutesAgo: 40 },
    { dir: "OUTBOUND", body: "Hola, te bendigo", minutesAgo: 39 },
  ]);
  await chat(OLD, "Fuera de ventana", [{ dir: "INBOUND", body: "Hola", minutesAgo: 60 * 30 }]);
  const pending = (await findUnansweredChats({ minAgeMin: 10, limit: 200, includeEscalated: true })).map((c) => c.name);
  check("el chat sin respuesta aparece", pending.includes("Sin respuesta"), pending);
  check("el contestado y el de hace 30 h no", !pending.includes("Contestada") && !pending.includes("Fuera de ventana"), pending);

  console.log("5. Enlace de pago");
  const product = await prisma.product.findFirst({ where: { isActive: true }, select: { id: true } });
  if (product && decided.contactId) {
    await prisma.paymentLink.create({ data: { token: "e2epay" + Date.now().toString(16), contactId: decided.contactId, productId: product.id, revokedAt: new Date() } });
    check("un enlace revocado no se manda", (await activePaymentLinkFor(decided.contactId)) === null);
    await prisma.paymentLink.create({ data: { token: "e2epay2" + Date.now().toString(16), contactId: decided.contactId, productId: product.id } });
    check("el enlace vivo se encuentra", Boolean((await activePaymentLinkFor(decided.contactId))?.url.includes("/pagar/")));
  }

  await cleanup();
  if (failures.length) {
    console.error(`\n❌ ${failures.length} fallaron: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\n✅ Pagos, pausas y pendientes OK");
};

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => undefined);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
