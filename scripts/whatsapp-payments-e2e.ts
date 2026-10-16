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
 * 6. Clienta de México (el chat llega como 521…, 15-oct-2026): al confirmar
 *    queda con su número válido +52, el chat vinculado y clienta.
 * 7. Si ya estaba en el CRM como +52…, se vincula ese contacto (no otro).
 * 8. Dayana confirma desde el celular («he recibido», nota de voz): queda
 *    confirmado sin usuario del CRM y sin mandarle nada. Otro mensaje, un
 *    «recibido» de antes del comprobante o de más de 48 h después, no.
 * 9. Confirmado sin pago en el CRM: lo pide hasta que se enlaza un pago
 *    aprobado de la misma persona (una vez) o Dayana dice «no hace falta».
 * 10. Marcarla clienta a mano la deja en el CRM; un chat sin número no falla.
 * 11. Dos confirmaciones a la vez: una sola gana y queda un solo contacto.
 */
import { prisma } from "@/lib/db";
import { markClient } from "@/lib/crm/whatsapp-agent/segment-store";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { MANUAL_PAUSE_REASON } from "@/lib/crm/whatsapp-attention-rules";
import { pauseAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { findUnansweredChats } from "@/lib/crm/whatsapp-agent/catch-up";
import { activePaymentLinkFor, listReceipts, saveReceipt } from "@/lib/crm/whatsapp-agent/payment-info";
import {
  confirmReceiptFromChat,
  decideReceipt,
  dismissReceiptPayment,
  linkReceiptPayment,
  ReceiptError,
} from "@/lib/crm/whatsapp-agent/receipts";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";
import { getChat } from "@/lib/crm/whatsapp-agent/workspace";
import { contactPhoneCandidates } from "@/lib/whatsapp-contact";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
// Los avisos quedan en la base de desarrollo: sin clave, Inngest rechaza el
// evento del correo (si no, saldría a Inngest con la clave del .env).
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;

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
// México con el 1 de más (521 + 10, como llega de WhatsApp) y un id de usuario sin número.
const MX_NEW = "5215500007721";
const MX_KNOWN = "5215500007722";
const MX_ACK = "5215500007723";
const NO_ACK = "573000007724";
const MARKED = "573000007725";
const BSUID = "PE.0000000077260";
const RACE = "5215500007727";
const THREADS = [PAYER, CLAIMS, PAUSE, PENDING, ANSWERED, OLD, MX_NEW, MX_KNOWN, MX_ACK, NO_ACK, MARKED, BSUID, RACE];

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

const receiptPhoto = (mediaId: string) => [{ kind: "image", url: null, mediaId, mimeType: "image/jpeg", caption: null }];

let echoes = 0;
/** Lo que Dayana escribe desde el celular: llega como eco (no lo mandó el CRM). */
const echo = async (conversationId: string, body: string, sentAt: Date) => {
  const externalMessageId = `wamid.e2e.pay.echo.${conversationId}.${++echoes}`;
  await prisma.conversationMessage.create({
    data: { conversationId, direction: "OUTBOUND", status: "DELIVERED", isEcho: true, isAutoReply: false, kind: "message", externalMessageId, body, sentAt },
  });
  return externalMessageId;
};

/** El código de error de un ReceiptError (null si no falló). */
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof ReceiptError ? e.message : String(e))
  );

/** El aviso a Dayana sale en segundo plano: llega en unos instantes. */
const waitFor = async (ok: () => Promise<boolean>, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (await ok()) return true;
  return false;
};

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await prisma.platformNotification.deleteMany({ where: { entityType: "Conversation", entityId: { in: ids } } });
  await prisma.whatsAppPaymentReceipt.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.contactChannelIdentity.deleteMany({ where: { externalId: { in: THREADS } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  // El contacto de un chat 521… se guarda como +52…: se buscan todas las formas.
  const contacts = await prisma.contact.findMany({ where: { phoneE164: { in: THREADS.flatMap(contactPhoneCandidates) } }, select: { id: true } });
  const contactIds = contacts.map((c) => c.id);
  await prisma.paymentLink.deleteMany({ where: { contactId: { in: contactIds } } });
  // Los pagos se van con su matrícula.
  await prisma.enrollment.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
};

const main = async () => {
  await cleanup();
  // Las pausas como en producción (apagadas); al final se deja como estaba.
  const previous = await getWhatsAppAiConfig();
  await setWhatsAppAiConfig({ ...previous, pauses: { onHumanReply: false, onEscalation: false } });
  try {
    await cases();
  } finally {
    await setWhatsAppAiConfig(previous);
  }
};

const cases = async () => {
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

  console.log("6. Clienta de México (chat 521…): al confirmar queda con su número +52");
  const mx = await chat(MX_NEW, "Gabriela Ruiz", [{ dir: "INBOUND", body: null, minutesAgo: 3, attachments: receiptPhoto("223456789") }]);
  const mxReceipt = await saveReceipt({ conversationId: mx.id, contactId: null, messageId: mx.messages[0].id, method: "Transferencia", amount: 80, currency: "USD", summary: "Transferencia desde México" });
  const mxDecided = await decideReceipt({ receiptId: mxReceipt.id, decision: "confirm", staffUserId: staff.id, message: "" });
  const mxContact = mxDecided.contactId
    ? await prisma.contact.findUnique({ where: { id: mxDecided.contactId }, select: { phoneE164: true, phoneCountryIso: true } })
    : null;
  check("se crea el contacto con el número válido (+52, sin el 1)", mxContact?.phoneE164 === "+525500007721" && mxContact.phoneCountryIso === "MX", mxContact);
  const mxChat = await prisma.conversation.findUnique({ where: { id: mx.id }, select: { contactId: true, category: true, categorySource: true } });
  check("el chat queda vinculado y clienta a mano", mxChat?.contactId === mxDecided.contactId && mxChat?.category === "cliente" && mxChat.categorySource === "manual", mxChat);
  const mxRow = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: mxReceipt.id } });
  check(
    "el comprobante queda confirmado con el botón y con su contacto",
    mxRow?.status === "confirmed" && mxRow.confirmedVia === "button" && mxRow.decidedById === staff.id && mxRow.contactId === mxDecided.contactId,
    mxRow
  );

  console.log("7. Ya estaba en el CRM como +52…: se vincula ese contacto");
  const known = await prisma.contact.create({
    data: { phoneE164: "+525500007722", phoneCountryIso: "MX", firstName: "Sofía", lastName: "Herrera", source: "WHATSAPP_DIRECT" },
    select: { id: true },
  });
  const mxKnown = await chat(MX_KNOWN, "Sofi", [{ dir: "INBOUND", body: "Te mando el comprobante", minutesAgo: 4 }]);
  const knownReceipt = await saveReceipt({ conversationId: mxKnown.id, contactId: null, messageId: mxKnown.messages[0].id, summary: "Depósito OXXO" });
  const knownDecided = await decideReceipt({ receiptId: knownReceipt.id, decision: "confirm", staffUserId: staff.id });
  check("se vincula el contacto que ya existía", knownDecided.contactId === known.id, knownDecided);
  const sameNumber = await prisma.contact.count({ where: { phoneE164: { in: contactPhoneCandidates(MX_KNOWN) } } });
  check("no se duplica el contacto", sameNumber === 1, sameNumber);

  console.log("8. Dayana confirma desde el celular («he recibido»)");
  const ack = await chat(MX_ACK, "Paola Méndez", [{ dir: "INBOUND", body: null, minutesAgo: 10, attachments: receiptPhoto("323456789") }]);
  const ackReceipt = await saveReceipt({
    conversationId: ack.id,
    contactId: null,
    messageId: ack.messages[0].id,
    summary: "Transferencia desde México",
    confirmMessage: "Recibido, Dayana lo revisa y te confirmamos",
  });
  check("el mensaje de espera no se ofrece para confirmar", (await listReceipts(ack.id))[0]?.confirmMessage === null);
  const voice = await echo(ack.id, "🎤 Mi hermosa, te bendigo, he recibido, mi bella, muchísimas gracias.", new Date(ackReceipt.createdAt.getTime() + 60_000));
  check("su nota de voz confirma el comprobante", (await confirmReceiptFromChat(ack.id, voice)) === 1);
  const ackRow = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: ackReceipt.id } });
  check(
    "queda confirmado desde el chat, sin usuario del CRM",
    ackRow?.status === "confirmed" && ackRow.confirmedVia === "chat" && ackRow.decidedById === null && Boolean(ackRow.contactId),
    ackRow
  );
  const ackChat = await prisma.conversation.findUnique({ where: { id: ack.id }, select: { contactId: true, category: true, contact: { select: { phoneE164: true } } } });
  check("se crea su contacto (+52) y queda clienta", ackChat?.contact?.phoneE164 === "+525500007723" && ackChat.contactId === ackRow?.contactId && ackChat.category === "cliente", ackChat);
  const crmSent = await prisma.conversationMessage.count({ where: { conversationId: ack.id, direction: "OUTBOUND", isEcho: false } });
  check("el CRM no le manda nada", crmSent === 0, crmSent);
  check(
    "le llega el aviso a Dayana",
    await waitFor(async () => (await prisma.platformNotification.count({ where: { eventType: "WHATSAPP_AI_INFO", entityType: "Conversation", entityId: ack.id } })) > 0)
  );
  const ackView = (await listReceipts(ack.id)).find((r) => r.id === ackReceipt.id);
  check("se ve que Dayana ya le respondió", ackView?.dayanaReplied === true && ackView.confirmedVia === "chat", ackView);

  const noAck = await chat(NO_ACK, "Carolina", [{ dir: "INBOUND", body: "Ya te envié el comprobante", minutesAgo: 10 }]);
  const noAckReceipt = await saveReceipt({ conversationId: noAck.id, contactId: null, messageId: noAck.messages[0].id, summary: "Comprobante" });
  const afterReceipt = new Date(noAckReceipt.createdAt.getTime() + 60_000);
  const beforeReceipt = new Date(noAckReceipt.createdAt.getTime() - 60_000);
  check("«Un abrazo mi bella» no confirma nada", (await confirmReceiptFromChat(noAck.id, await echo(noAck.id, "Un abrazo mi bella", afterReceipt))) === 0);
  check("un «recibido» de antes del comprobante tampoco", (await confirmReceiptFromChat(noAck.id, await echo(noAck.id, "Recibido, muchas gracias", beforeReceipt))) === 0);
  await prisma.whatsAppPaymentReceipt.update({ where: { id: noAckReceipt.id }, data: { createdAt: new Date(Date.now() - 50 * 3600_000) } });
  check("ni uno de más de 48 h después", (await confirmReceiptFromChat(noAck.id, await echo(noAck.id, "Recibido, muchas gracias", new Date()))) === 0);
  const noAckRow = await prisma.whatsAppPaymentReceipt.findUnique({ where: { id: noAckReceipt.id }, select: { status: true, conversation: { select: { contactId: true } } } });
  check("sigue por confirmar y sin contacto", noAckRow?.status === "pending" && noAckRow.conversation.contactId === null, noAckRow);

  console.log("9. Falta registrar el pago en el CRM");
  check("confirmado sin pago: pide registrarlo", (await listReceipts(mx.id)).find((r) => r.id === mxReceipt.id)?.needsPayment === true);
  if (!product) throw new Error("Falta un producto activo en la base de desarrollo.");
  // Como lo deja «Registrar pago»: matrícula y pago manual (sin pasar por Inngest ni correos).
  const payment = async (contactId: string, status: "APPROVED" | "PENDING") => {
    const enrollment = await prisma.enrollment.create({
      data: { contactId, productId: product.id, status: "ACTIVE", amountMinor: 8000, currency: "USD" },
      select: { id: true },
    });
    return prisma.payment.create({
      data: {
        enrollmentId: enrollment.id,
        provider: "MANUAL",
        providerPaymentId: `e2e-receipt-${enrollment.id}`,
        status,
        currency: "USD",
        amountMinor: 8000,
        paidAt: status === "APPROVED" ? new Date() : null,
      },
      select: { id: true },
    });
  };
  const mxPayment = await payment(mxDecided.contactId ?? "", "APPROVED");
  check("un comprobante por confirmar no se enlaza", (await errorOf(linkReceiptPayment({ receiptId: noAckReceipt.id, paymentId: mxPayment.id, staffUserId: staff.id }))) === "not_confirmed");
  await linkReceiptPayment({ receiptId: mxReceipt.id, paymentId: mxPayment.id, staffUserId: staff.id });
  const linkedView = (await listReceipts(mx.id)).find((r) => r.id === mxReceipt.id);
  check("con el pago enlazado ya no lo pide", linkedView?.needsPayment === false && linkedView.paymentId === mxPayment.id, linkedView);
  check("se enlaza una sola vez", (await errorOf(linkReceiptPayment({ receiptId: mxReceipt.id, paymentId: mxPayment.id, staffUserId: staff.id }))) === "already_linked");
  check("el pago de otra persona no se enlaza", (await errorOf(linkReceiptPayment({ receiptId: knownReceipt.id, paymentId: mxPayment.id, staffUserId: staff.id }))) === "other_contact");
  const unpaid = await payment(known.id, "PENDING");
  check("un pago sin aprobar no se enlaza", (await errorOf(linkReceiptPayment({ receiptId: knownReceipt.id, paymentId: unpaid.id, staffUserId: staff.id }))) === "payment_not_found");
  check("y ese comprobante lo sigue pidiendo", (await listReceipts(mxKnown.id)).find((r) => r.id === knownReceipt.id)?.needsPayment === true);
  await dismissReceiptPayment({ receiptId: ackReceipt.id, staffUserId: staff.id });
  check("«no hace falta» deja de pedirlo", (await listReceipts(ack.id)).find((r) => r.id === ackReceipt.id)?.needsPayment === false);

  console.log("10. Dayana la marca clienta a mano: queda en el CRM");
  const marked = await chat(MARKED, "Natalia Torres", [{ dir: "INBOUND", body: "Gracias por la sesión de hoy", minutesAgo: 20 }]);
  await markClient(marked.id, true, null);
  const markedChat = await prisma.conversation.findUnique({ where: { id: marked.id }, select: { contactId: true, contact: { select: { phoneE164: true, firstName: true } } } });
  check("se crea el contacto y se vincula", markedChat?.contact?.phoneE164 === `+${MARKED}` && markedChat.contact.firstName === "Natalia", markedChat);
  const userId = await chat(BSUID, "Usuaria sin número", [{ dir: "INBOUND", body: "Hola", minutesAgo: 20 }]);
  const userIdError = await markClient(userId.id, true, null).then(
    () => null,
    (e: unknown) => String(e)
  );
  const userIdChat = await prisma.conversation.findUnique({ where: { id: userId.id }, select: { contactId: true, category: true } });
  check("un chat sin número (id de usuario) no falla ni inventa un contacto", userIdError === null && userIdChat?.contactId === null && userIdChat.category === "cliente", {
    userIdError,
    userIdChat,
  });

  console.log("11. Dos confirmaciones a la vez");
  const race = await chat(RACE, "Valeria Soto", [{ dir: "INBOUND", body: null, minutesAgo: 2, attachments: receiptPhoto("423456789") }]);
  const raceReceipt = await saveReceipt({ conversationId: race.id, contactId: null, messageId: race.messages[0].id, summary: "Transferencia" });
  const both = await Promise.allSettled([1, 2].map(() => decideReceipt({ receiptId: raceReceipt.id, decision: "confirm", staffUserId: staff.id })));
  const won = both.filter((r) => r.status === "fulfilled").length;
  const lost = both.filter((r) => r.status === "rejected" && r.reason instanceof ReceiptError && r.reason.message === "already_decided").length;
  check("una sola confirma; la otra ya estaba decidida", won === 1 && lost === 1, both.map((r) => (r.status === "fulfilled" ? "ok" : String(r.reason))));
  const raceContacts = await prisma.contact.count({ where: { phoneE164: { in: contactPhoneCandidates(RACE) } } });
  check("queda un solo contacto", raceContacts === 1, raceContacts);

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
