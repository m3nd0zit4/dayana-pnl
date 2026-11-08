/**
 * Números bloqueados y contenido sexual, contra la base de DESARROLLO. Sin
 * envíos de verdad: el aviso, el bloqueo en WhatsApp, Blob y la lista de
 * bloqueados son falsos (la base de dev tiene una clave REAL de 360dialog).
 *
 *   bun --env-file=../dayana-pnl/.env scripts/whatsapp-blocked-e2e.ts
 *
 * 1. Un texto inequívoco («mándame el pack») se marca al guardarse; uno de
 *    terapia («sufrí abuso sexual») no.
 * 2. Contenido sexual: aviso → bloqueo → chat, mensajes y cola borrados,
 *    archivos de Blob borrados, contacto oculto (no borrado), fila mínima.
 * 3. Bloqueado: no entra otro mensaje, no le sale nada (`sendMetaMessage`,
 *    notificaciones) y la IA no lo atiende; una segunda vez no repite nada.
 * 4. Un número personal no se bloquea solo.
 * 5. La lista de WhatsApp: un bloqueado en la app sale de las listas del CRM y
 *    vuelve al desbloquearlo; un bloqueo que la API no aceptó no se suelta.
 */
import { prisma } from "@/lib/db";
import { blockHash, isBlockedNumber, isBlockedPhone, syncBlockList } from "@/lib/crm/whatsapp-blocked-numbers";
import { ignoreNumbers, unignoreNumber } from "@/lib/crm/whatsapp-ignored-numbers";
import { enforceSexualContent } from "@/lib/crm/whatsapp-agent/sexual-content";
import { listChats, queueCounts } from "@/lib/crm/whatsapp-agent/workspace";
import { ingestMessage } from "@/lib/meta/ingest";
import { BlockedRecipientError, sendMetaMessage } from "@/lib/meta/send";
import { sendWhatsAppTemplateMessage } from "@/lib/notifications/channels/whatsapp";

if (new URL(process.env.DATABASE_URL!).pathname !== "/neondb_dev") throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
process.env.GEMINI_API_KEY = "";
process.env.GEMINI_API_KEY_2 = "";
process.env.GEMINI_API_KEYS = "";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

// Números de prueba (México en sus dos formas, para probar las variantes).
const SEXUAL = "5215500009911";
const SEXUAL_ALT = "525500009911";
const APP = "573000009912";
const PERSONAL = "573000009913";
const THERAPY = "573000009914";
const ALL = [SEXUAL, SEXUAL_ALT, APP, PERSONAL, THERAPY];
const ACCOUNT = "e2e-blocked";

const cleanup = async () => {
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: ALL } } });
  await prisma.contact.deleteMany({ where: { phoneE164: { in: ALL.map((n) => `+${n}`) } } });
  const hashes = ALL.map(blockHash).filter((h): h is string => Boolean(h));
  await prisma.whatsAppBlockedNumber.deleteMany({ where: { phoneHash: { in: hashes } } });
  await unignoreNumber(PERSONAL);
};

const msg = (threadId: string, body: string, n: number) => ({
  kind: "message" as const,
  channel: "WHATSAPP" as const,
  metaAccountId: ACCOUNT,
  threadId,
  externalMessageId: `wamid.e2e-blocked-${threadId}-${n}-${Date.now()}`,
  isEcho: false,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: "Prueba Bloqueo",
});

const fakes = () => {
  const calls = { notice: [] as string[], block: [] as string[], blobs: [] as string[] };
  return {
    calls,
    deps: {
      silent: true,
      sendNotice: async (conversationId: string, body: string) => {
        calls.notice.push(body);
        // Como el envío real: una fila saliente en el chat.
        await prisma.conversationMessage.create({
          data: { conversationId, direction: "OUTBOUND", status: "SENT", body, source: "sistema:bloqueo", isAutoReply: true },
        });
        return { sent: true };
      },
      blockApi: async (threadId: string) => {
        calls.block.push(threadId);
        return { ok: true, error: null };
      },
      deleteBlobs: async (urls: string[]) => {
        calls.blobs.push(...urls);
      },
    },
  };
};

const main = async () => {
  await cleanup();

  console.log("1. Texto inequívoco vs. terapia");
  const explicit = await ingestMessage(msg(SEXUAL, "hola, mándame el pack 😏", 1));
  check("«mándame el pack» se guarda marcado como contenido sexual", explicit.outcome === "stored" && explicit.sexual?.reason === "nude_request", explicit);
  const therapy = await ingestMessage(msg(THERAPY, "Sufrí abuso sexual de niña y quiero sanarlo con Dayana", 1));
  check("«sufrí abuso sexual» no se marca", therapy.outcome === "stored" && !therapy.sexual, therapy);

  console.log("2. Contenido sexual: aviso, bloqueo, borrado, contacto oculto");
  if (explicit.outcome !== "stored") throw new Error("sin chat");
  const convId = explicit.conversationId;
  const contact = await prisma.contact.create({
    data: { phoneE164: `+${SEXUAL}`, firstName: "Prueba", lastName: "Bloqueo" },
  });
  await prisma.conversation.update({ where: { id: convId }, data: { contactId: contact.id } });
  await prisma.conversationMessage.create({
    data: {
      conversationId: convId,
      direction: "INBOUND",
      status: "RECEIVED",
      body: "[foto]",
      externalMessageId: `wamid.e2e-blocked-photo-${Date.now()}`,
      attachments: [{ kind: "image", url: "https://abc.private.blob.vercel-storage.com/inbox/e2e-falsa.jpg", mimeType: "image/jpeg", caption: null }],
    },
  });
  const f = fakes();
  const r = await enforceSexualContent({ conversationId: convId, signal: { source: "text", reason: "nude_request" } }, f.deps);
  check("bloqueado", r.status === "blocked", r);
  check("UN aviso con «va a ser reportado… debido a estas acciones»", f.calls.notice.length === 1 && /va a ser reportado.*debido a estas acciones/.test(f.calls.notice[0]), f.calls.notice);
  check("bloqueo por la API con el número", f.calls.block.length === 1 && f.calls.block[0] === SEXUAL, f.calls.block);
  check("el archivo de Blob se borró", f.calls.blobs.length === 1, f.calls.blobs);
  check("el chat ya no existe", (await prisma.conversation.count({ where: { id: convId } })) === 0);
  check("ni sus mensajes", (await prisma.conversationMessage.count({ where: { conversationId: convId } })) === 0);
  const c = await prisma.contact.findUnique({ where: { id: contact.id }, select: { blockedAt: true } });
  check("el contacto sigue (no se borra) pero oculto", Boolean(c?.blockedAt), c);
  const row = await prisma.whatsAppBlockedNumber.findUnique({ where: { phoneHash: blockHash(SEXUAL)! } });
  check(
    "fila mínima: motivo, señal, API, conteos; sin número ni contenido",
    row?.reason === "sexual_content" &&
      row.detail === "text:nude_request" &&
      Boolean(row.apiBlockedAt) &&
      !JSON.stringify(row).includes(SEXUAL.slice(-7)) &&
      !JSON.stringify(row).includes("pack"),
    row
  );

  console.log("3. Bloqueado: no entra, no sale, la IA no lo atiende");
  check("bloqueado en sus dos formas (521 / 52)", (await isBlockedNumber(SEXUAL)) && (await isBlockedNumber(SEXUAL_ALT)) && (await isBlockedPhone(`+${SEXUAL_ALT}`)));
  const again = await ingestMessage(msg(SEXUAL_ALT, "hola?", 2));
  check("otro mensaje no entra", again.outcome === "ignored" && again.reason === "blocked_number", again);
  // Un chat viejo del número (p. ej. de antes) no deja enviar.
  const ghost = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: SEXUAL, metaAccountId: ACCOUNT, lastInboundAt: new Date() },
  });
  const sendErr = await sendMetaMessage({ conversationId: ghost.id, body: "hola" }).then(() => null, (e: unknown) => e);
  check("sendMetaMessage se niega", sendErr instanceof BlockedRecipientError, String(sendErr));
  check("y no dejó fila en el chat", (await prisma.conversationMessage.count({ where: { conversationId: ghost.id } })) === 0);
  const notifErr = await sendWhatsAppTemplateMessage({ toE164: `+${SEXUAL}`, body: "tu pago" }).then(() => null, (e: unknown) => e);
  check("las notificaciones por WhatsApp también", notifErr instanceof Error && /bloqueado/i.test(notifErr.message), String(notifErr));
  const f2 = fakes();
  const r2 = await enforceSexualContent({ conversationId: ghost.id, signal: { source: "vision", reason: "PROHIBITED_CONTENT" } }, f2.deps);
  check("una segunda vez no repite aviso ni bloqueo, pero limpia el chat", r2.status === "already" && f2.calls.notice.length === 0 && f2.calls.block.length === 0 && (await prisma.conversation.count({ where: { id: ghost.id } })) === 0, r2);

  console.log("4. Un número personal de Dayana no se bloquea solo");
  await ignoreNumbers([PERSONAL], "manual");
  const p = await ingestMessage(msg(PERSONAL, "jaja mira esto", 1));
  if (p.outcome !== "stored") throw new Error("sin chat personal");
  const f3 = fakes();
  const r3 = await enforceSexualContent({ conversationId: p.conversationId, signal: { source: "vision", reason: "MODEL:nudity" } }, f3.deps);
  check("se salva (Dayana decide)", r3.status === "spared" && f3.calls.notice.length === 0 && f3.calls.block.length === 0, r3);
  check("y su chat sigue", (await prisma.conversation.count({ where: { id: p.conversationId } })) === 1);

  console.log("5. Bloqueados en la app de Dayana (lista de WhatsApp)");
  const a = await ingestMessage(msg(APP, "hola, quiero info", 1));
  if (a.outcome !== "stored") throw new Error("sin chat app");
  await prisma.contact.create({ data: { phoneE164: `+${APP}`, firstName: "Bloqueada", lastName: "App" } });
  const inList = async () => (await listChats({ queue: "all", q: APP })).some((x) => x.id === a.conversationId);
  check("antes: aparece en la lista de chats", await inList());
  const s1 = await syncBlockList({ list: async () => [APP, SEXUAL] });
  check("la lista la oculta", s1.added === 1 && s1.hiddenChats === 1, s1);
  check("ya no aparece ni buscándola", !(await inList()));
  check("el contacto quedó oculto", Boolean((await prisma.contact.findUnique({ where: { phoneE164: `+${APP}` } }))?.blockedAt));
  check("los números de las pestañas cuentan sin ella", typeof (await queueCounts()).attention === "number");
  check("la IA no la atiende (bloqueada)", await isBlockedNumber(APP));
  const s2 = await syncBlockList({ list: async () => [SEXUAL] });
  check("desbloqueada en la app: vuelve", s2.removed === 1 && s2.shownChats === 1 && (await inList()), s2);
  check("su contacto también", !(await prisma.contact.findUnique({ where: { phoneE164: `+${APP}` } }))?.blockedAt);
  // El de contenido sexual con un bloqueo que la API no aceptó no se suelta por faltar en la lista.
  await prisma.whatsAppBlockedNumber.update({ where: { phoneHash: blockHash(SEXUAL)! }, data: { apiBlockedAt: null } });
  const s3 = await syncBlockList({ list: async () => [] });
  check("un bloqueo sin API no se suelta", s3.removed === 0 && (await isBlockedNumber(SEXUAL)), s3);
};

try {
  await main();
} finally {
  await cleanup().catch((e) => console.warn("limpieza", e));
}
console.log(failures.length ? `\n❌ ${failures.length} fallas: ${failures.join(" | ")}` : "\n✅ Todo bien");
process.exit(failures.length ? 1 : 0);
