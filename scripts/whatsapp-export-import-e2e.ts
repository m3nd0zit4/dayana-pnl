/**
 * Chats exportados desde el celular → chats reales del CRM. Contra la base de
 * DESARROLLO.
 *
 *   bun scripts/whatsapp-export-import-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Un chat de Android (multilínea, adjunto, aviso de sistema) crea su
 *    conversación con el id de WhatsApp del número y todos sus mensajes.
 * 2. Lo que escribió Dayana queda saliente (eco); lo de la persona, entrante.
 * 3. Es historial: sin no leídos y el chat queda cerrado.
 * 4. Subirlo otra vez no crea nada.
 * 5. Un número de México (+52 55…) queda en el hilo 521…
 * 6. Lo que ya llegó en vivo por WhatsApp no se repite.
 */
import { prisma } from "@/lib/db";
import { importExportChat } from "@/lib/crm/whatsapp-export-import";
import { whatsAppDigits } from "@/lib/whatsapp-contact";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const CO_PHONE = "+573000006711";
const MX_PHONE = "+52 55 1234 5678";
const MX_THREAD = "5215512345678";
const CO_THREAD = whatsAppDigits(CO_PHONE);

const EXPORT = [
  "12/03/25, 9:58 - Los mensajes y las llamadas están cifrados de extremo a extremo. Nadie fuera de este chat, ni siquiera WhatsApp, puede leerlos ni escucharlos. Toca para obtener más información.",
  "12/03/25, 10:00 - Laura: Hola Dayana, buen día 🌸",
  "12/03/25, 10:01 - Laura: ¿Cuánto cuesta la lectura de registros?",
  "12/03/25, 10:15 - Dayana Beltrán: Hola Laura, qué alegría leerte 💛",
  "La lectura cuesta 180.000 COP y dura una hora.",
  "¿Te queda bien el jueves?",
  "12/03/25, 10:20 - Laura: <Multimedia omitido>",
  "12/03/25, 10:21 - Laura: Ya te mandé el comprobante",
  "12/03/25, 10:30 - Dayana Beltrán: Recibido, gracias hermosa. Te espero el jueves a las 3 pm",
].join("\n");

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: [CO_THREAD, MX_THREAD, "525512345678"] } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
};

const main = async () => {
  await cleanup();
  try {
    console.log("\n1. Chat de Android → conversación real");
    const first = await importExportChat({
      text: EXPORT,
      fileName: "Chat de WhatsApp con Laura.txt",
      phoneE164: CO_PHONE,
      dayanaAuthor: "Dayana Beltrán",
    });
    check("se guardaron los 6 mensajes", first.stored === 6 && first.total === 6, first);
    const conv = await prisma.conversation.findUnique({
      where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: CO_THREAD } },
    });
    check("conversación con el id de WhatsApp", Boolean(conv) && conv!.id === first.conversationId, conv?.id);
    check("nombre de la persona", conv?.participantName === "Laura", conv?.participantName);

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: conv!.id },
      orderBy: { sentAt: "asc" },
    });
    check("6 mensajes en el chat", messages.length === 6, messages.length);

    console.log("\n2. Dirección de cada mensaje");
    check(
      "Dayana saliente (eco), Laura entrante",
      JSON.stringify(messages.map((m) => `${m.direction}:${m.isEcho}`)) ===
        JSON.stringify(["INBOUND:false", "INBOUND:false", "OUTBOUND:true", "INBOUND:false", "INBOUND:false", "OUTBOUND:true"]),
      messages.map((m) => m.direction)
    );
    check(
      "mensaje multilínea completo",
      messages[2]?.body === "Hola Laura, qué alegría leerte 💛\nLa lectura cuesta 180.000 COP y dura una hora.\n¿Te queda bien el jueves?",
      messages[2]?.body
    );
    check("adjunto como aviso gris", messages.some((m) => m.kind === "system" && m.body?.includes("Archivo no incluido")));
    check("10:00 de Bogotá = 15:00 UTC", messages[0]?.sentAt.toISOString() === "2025-03-12T15:00:00.000Z", messages[0]?.sentAt);

    console.log("\n3. Es historial");
    check("sin no leídos", conv?.unreadCount === 0, conv?.unreadCount);
    check("chat cerrado", conv?.status === "CLOSED", conv?.status);
    check("última actividad = último mensaje", conv?.lastMessageAt.toISOString() === messages[5]?.sentAt.toISOString());

    console.log("\n4. Subirlo otra vez no duplica");
    const again = await importExportChat({
      text: EXPORT,
      fileName: "Chat de WhatsApp con Laura.txt",
      phoneE164: CO_PHONE,
      dayanaAuthor: "Dayana Beltrán",
    });
    check("0 nuevos", again.stored === 0 && again.duplicates === 6, again);
    check(
      "sigue con 6 mensajes",
      (await prisma.conversationMessage.count({ where: { conversationId: conv!.id } })) === 6
    );

    console.log("\n5. Número de México");
    const mx = await importExportChat({
      text: EXPORT,
      fileName: "Chat de WhatsApp con Laura.txt",
      phoneE164: MX_PHONE,
      dayanaAuthor: "Dayana Beltrán",
    });
    check("hilo 5215512345678", mx.threadId === MX_THREAD && mx.stored === 6, mx);
    const mxConv = await prisma.conversation.findUnique({
      where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: MX_THREAD } },
    });
    check("la conversación existe", Boolean(mxConv));

    console.log("\n6. Lo que llegó en vivo no se repite");
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv!.id,
        direction: "INBOUND",
        status: "RECEIVED",
        externalMessageId: `wamid.export-e2e.${Date.now()}`,
        body: "¿Y el viernes también?",
        isEcho: false,
        sentAt: new Date("2025-03-12T15:40:00.000Z"),
      },
    });
    const withLive = await importExportChat({
      text: `${EXPORT}\n12/03/25, 10:40 - Laura: ¿Y el viernes también?\n12/03/25, 10:45 - Dayana Beltrán: Sí, también`,
      fileName: "Chat de WhatsApp con Laura.txt",
      phoneE164: CO_PHONE,
      dayanaAuthor: "Dayana Beltrán",
    });
    check("solo 1 nuevo (el de Dayana)", withLive.stored === 1 && withLive.alreadyInCrm === 1, withLive);
  } finally {
    await cleanup();
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallos` : "\n✅ Todo bien");
  await prisma.$disconnect();
  if (failures.length) process.exit(1);
};

void main();
