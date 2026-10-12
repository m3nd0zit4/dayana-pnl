/**
 * Una persona, un chat. Contra la base de DESARROLLO.
 *
 *   bun scripts/whatsapp-identity-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Chat importado de México (521…) + mensaje en vivo con 52…: mismo chat.
 * 2. Brasil: importado con 9, en vivo sin 9: mismo chat.
 * 3. Lo que Dayana escribe desde el celular a alguien con nombre de usuario
 *    (BSUID) cae en su chat, no en un chat fantasma.
 * 4. Eco con teléfono + id de usuario: cae en el chat del id de usuario.
 * 5. El script de unir duplicados junta dos chats viejos del mismo número.
 */
import { spawnSync } from "node:child_process";

import { prisma } from "@/lib/db";
import { importExportChat } from "@/lib/crm/whatsapp-export-import";
import { normalizeMetaPayload, type NormalizedMessage } from "@/lib/meta/inbound";
import { ingestMessage } from "@/lib/meta/ingest";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const MX_IMPORTED = "5215512349901";
const MX_LIVE = "525512349901";
const BR_IMPORTED = "5511987659901";
const BR_LIVE = "551187659901";
const BSUID = "CO.9990000000009901";
const BSUID_PHONE = "573000009901";
const DUP_A = "525598769901";
const DUP_B = "5215598769901";
const THREADS = [MX_IMPORTED, MX_LIVE, BR_IMPORTED, BR_LIVE, BSUID, BSUID_PHONE, "9990000000009901", DUP_A, DUP_B];

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppMemory.deleteMany({ where: { phone: { in: THREADS } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
};

const EXPORT = (name: string) =>
  [`12/09/26, 10:00 - ${name}: Hola, quiero información`, "12/09/26, 10:05 - Dayana Beltrán: Hola, te bendigo. ¿Cómo estás?"].join("\n");

const live = (threadId: string, id: string, body: string): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "e2e",
  threadId,
  externalMessageId: id,
  isEcho: false,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: null,
});

const wrap = (value: Record<string, unknown>, field: string) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field, value: { metadata: { phone_number_id: "e2e" }, ...value } }] }],
});

const threadOf = async (conversationId: string | undefined) =>
  conversationId
    ? (await prisma.conversation.findUnique({ where: { id: conversationId }, select: { externalThreadId: true } }))?.externalThreadId
    : undefined;

const main = async () => {
  await cleanup();
  try {
    console.log("\n1. México: importado con 521, en vivo con 52");
    const mx = await importExportChat({ text: EXPORT("Ana"), fileName: "Chat de WhatsApp con Ana.txt", phoneE164: "+52 55 1234 9901", dayanaAuthor: "Dayana Beltrán" });
    const mxLive = await ingestMessage(live(MX_LIVE, "wamid.e2e.id.mx", "Hola otra vez"));
    check("el mensaje en vivo cae en el chat importado", mxLive.outcome === "stored" && mxLive.conversationId === mx.conversationId, mxLive);
    check("no se abrió un chat 52…", !(await prisma.conversation.findFirst({ where: { externalThreadId: MX_LIVE } })));

    console.log("\n2. Brasil: importado con 9, en vivo sin 9");
    const br = await importExportChat({ text: EXPORT("João"), fileName: "Chat de WhatsApp com João.txt", phoneE164: `+${BR_IMPORTED}`, dayanaAuthor: "Dayana Beltrán" });
    const brLive = await ingestMessage(live(BR_LIVE, "wamid.e2e.id.br", "Olá"));
    check("mismo chat", brLive.outcome === "stored" && brLive.conversationId === br.conversationId, { brLive, br: br.conversationId });

    console.log("\n3. Eco a alguien con nombre de usuario");
    const [first] = normalizeMetaPayload(
      wrap({ contacts: [{ user_id: BSUID, profile: { name: "Usuaria" } }], messages: [{ id: "wamid.e2e.id.u1", timestamp: "1790000000", type: "text", text: { body: "Hola" } }] }, "messages")
    );
    const userChat = first?.kind === "message" ? await ingestMessage(first) : null;
    check("el chat del id de usuario existe", userChat?.outcome === "stored" && (await threadOf(userChat.conversationId)) === BSUID, userChat);
    const [echo] = normalizeMetaPayload(
      wrap({ message_echoes: [{ id: "wamid.e2e.id.u2", from: "573105833188", to: BSUID, timestamp: "1790000100", type: "text", text: { body: "Hola, te bendigo" } }] }, "smb_message_echoes")
    );
    const echoed = echo?.kind === "message" ? await ingestMessage(echo) : null;
    check(
      "el eco cae en el mismo chat",
      echoed?.outcome === "stored" && userChat?.outcome === "stored" && echoed.conversationId === userChat.conversationId,
      echoed
    );
    check("sin chat fantasma 9990…", !(await prisma.conversation.findFirst({ where: { externalThreadId: "9990000000009901" } })));

    console.log("\n4. Eco con teléfono + id de usuario");
    const [echo2] = normalizeMetaPayload(
      wrap(
        { message_echoes: [{ id: "wamid.e2e.id.u3", from: "573105833188", to: BSUID_PHONE, to_user_id: BSUID, timestamp: "1790000200", type: "text", text: { body: "¿Cómo te sientes?" } }] },
        "smb_message_echoes"
      )
    );
    const echoed2 = echo2?.kind === "message" ? await ingestMessage(echo2) : null;
    check(
      "cae en el chat del id de usuario",
      echoed2?.outcome === "stored" && userChat?.outcome === "stored" && echoed2.conversationId === userChat.conversationId,
      echoed2
    );

    console.log("\n5. Unir duplicados viejos");
    const mk = (externalThreadId: string, n: number) =>
      prisma.conversation.create({
        data: {
          channel: "WHATSAPP",
          externalThreadId,
          metaAccountId: "e2e",
          lastMessageAt: new Date(),
          messages: {
            create: Array.from({ length: n }, (_, i) => ({
              direction: "INBOUND" as const,
              status: "DELIVERED" as const,
              externalMessageId: `wamid.e2e.id.dup.${externalThreadId}.${i}`,
              body: `m${i}`,
              sentAt: new Date(Date.now() - (n - i) * 60_000),
            })),
          },
        },
      });
    const a = await mk(DUP_A, 2);
    const b = await mk(DUP_B, 5);
    await prisma.whatsAppMemory.create({ data: { phone: DUP_A, notes: "- Vive en Monterrey" } });
    const dry = spawnSync("bun", ["scripts/whatsapp-merge-threads.ts"], { encoding: "utf8", env: process.env });
    check("la prueba no cambia nada", (await prisma.conversation.count({ where: { id: { in: [a.id, b.id] } } })) === 2, dry.stderr);
    const run = spawnSync("bun", ["scripts/whatsapp-merge-threads.ts", "--apply", "--i-have-a-backup"], { encoding: "utf8", env: process.env });
    const left = await prisma.conversation.findMany({ where: { id: { in: [a.id, b.id] } }, select: { id: true } });
    check("queda un solo chat (el de más mensajes)", left.length === 1 && left[0].id === b.id, { left, out: run.stdout.slice(-400), err: run.stderr.slice(-400) });
    check("con los 7 mensajes", (await prisma.conversationMessage.count({ where: { conversationId: b.id } })) === 7);
    check("la memoria se juntó", (await prisma.whatsAppMemory.findUnique({ where: { phone: DUP_B } }))?.notes.includes("Monterrey") === true);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Identidad: todo bien");
};

main();
