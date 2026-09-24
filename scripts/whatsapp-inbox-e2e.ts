/**
 * La cola de entrada no pierde mensajes. Contra la base de DESARROLLO.
 *
 *   bun scripts/whatsapp-inbox-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos (todos fueron formas reales de perder un mensaje):
 * 1. Un mensaje entra, se procesa y queda guardado en su chat.
 * 2. El mismo aviso repetido no crea nada nuevo.
 * 3. Si procesar falla, el evento queda para reintento y luego se guarda.
 * 4. Un acuse que llega antes que su mensaje espera y se aplica después.
 * 5. Un proceso que se cayó a medias (arriendo vencido) se retoma.
 * 6. El contador de no leídos sube una sola vez por mensaje.
 */
import { prisma } from "@/lib/db";
import type { NormalizedEvent } from "@/lib/meta/inbound";
import { drainInbox, enqueueMetaEvents } from "@/lib/meta/inbox";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const THREAD = "573000006601";
const run = Date.now();
const wamid = (n: string) => `wamid.inbox.${run}.${n}`;

const message = (id: string, body: string): NormalizedEvent => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId: THREAD,
  externalMessageId: wamid(id),
  isEcho: false,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: "Prueba Cola",
});

const enqueue = (events: NormalizedEvent[]) =>
  enqueueMetaEvents({ source: "e2e", object: "whatsapp_business_account", raw: { e2e: true }, events });

const rowOf = (key: string) => prisma.metaInboxEvent.findUnique({ where: { dedupeKey: key } });

const main = async () => {
  // Sin IA durante la prueba (el mensaje entrante la despertaría).
  const prevAi = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "false" },
    update: { value: "false" },
  });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: THREAD } });
  // Nada viejo de otras corridas en la cola.
  await prisma.metaInboxEvent.updateMany({ where: { state: { not: "DONE" } }, data: { state: "DONE" } });

  try {
    console.log("\n1. Un mensaje entra y queda guardado");
    const q1 = await enqueue([message("a", "Hola, ¿tienes citas?")]);
    check("se guardó en la cola antes de procesar", q1.queued === 1, q1);
    await drainInbox({ budgetMs: 30_000 });
    const m1 = await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("a") } });
    check("el mensaje está en su chat", Boolean(m1), m1?.id);
    check("el evento quedó DONE", (await rowOf(`msg:${wamid("a")}`))?.state === "DONE");

    console.log("\n2. El mismo aviso repetido");
    const q2 = await enqueue([message("a", "Hola, ¿tienes citas?")]);
    check("no entra otra vez a la cola", q2.queued === 0, q2);
    const count = await prisma.conversationMessage.count({ where: { externalMessageId: wamid("a") } });
    check("sigue habiendo un solo mensaje", count === 1, count);

    console.log("\n3. Procesar falla → se reintenta → se guarda");
    await enqueue([message("b", "Segundo mensaje")]);
    const key = `msg:${wamid("b")}`;
    const good = (await rowOf(key))!.normalized;
    // Un evento que revienta al guardarse (fecha inválida), como un fallo pasajero.
    await prisma.metaInboxEvent.update({
      where: { dedupeKey: key },
      data: { normalized: { ...(good as object), sentAt: "no-es-fecha" } },
    });
    await drainInbox({ budgetMs: 30_000 });
    const failed = await rowOf(key);
    check("quedó para reintento, no perdido", failed?.state === "FAILED" && Boolean(failed.lastError), failed?.state);
    check("todavía no hay mensaje (no se marcó «visto» sin guardar)", !(await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("b") } })));
    await prisma.metaInboxEvent.update({ where: { dedupeKey: key }, data: { normalized: good as object, nextAttemptAt: new Date(Date.now() - 60_000) } });
    await drainInbox({ budgetMs: 30_000 });
    check("al reintentar, el mensaje se guardó", Boolean(await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("b") } })));
    check("y el evento quedó DONE", (await rowOf(key))?.state === "DONE");

    console.log("\n4. Acuse antes que su mensaje");
    const out = wamid("out");
    await enqueue([
      { kind: "status", channel: "WHATSAPP", externalMessageId: out, status: "DELIVERED", at: new Date(), failedReason: null } as unknown as NormalizedEvent,
    ]);
    await drainInbox({ budgetMs: 30_000 });
    const early = await rowOf(`st:${out}:DELIVERED`);
    check("el acuse espera (no se tira)", early?.state === "FAILED", early?.state);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { externalThreadId: THREAD } });
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, direction: "OUTBOUND", status: "SENT", externalMessageId: out, body: "Te respondo", sentAt: new Date() },
    });
    await prisma.metaInboxEvent.update({ where: { dedupeKey: `st:${out}:DELIVERED` }, data: { nextAttemptAt: new Date(Date.now() - 60_000) } });
    await drainInbox({ budgetMs: 30_000 });
    const delivered = await prisma.conversationMessage.findUnique({ where: { externalMessageId: out } });
    check("cuando el mensaje existe, el acuse se aplica", delivered?.status === "DELIVERED", delivered?.status);

    console.log("\n5. Proceso caído a medias (arriendo vencido)");
    await enqueue([message("c", "Tercer mensaje")]);
    await prisma.metaInboxEvent.update({
      where: { dedupeKey: `msg:${wamid("c")}` },
      data: { state: "PROCESSING", leaseUntil: new Date(Date.now() - 60_000), attempts: 1 },
    });
    await drainInbox({ budgetMs: 30_000 });
    check("se retomó y se guardó", Boolean(await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("c") } })));

    console.log("\n6. No leídos");
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    check("3 mensajes entrantes → 3 sin leer (no más)", after.unreadCount === 3, after.unreadCount);

    console.log("\n7. Fantasmas y avisos de sistema (desde el webhook real)");
    const raw = (messages: Record<string, unknown>[]) => ({
      object: "whatsapp_business_account",
      entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "test-phone-id" }, contacts: [{ wa_id: THREAD, profile: { name: "Prueba Cola" } }], messages } }] }],
    });
    const { normalizeMetaPayload } = await import("@/lib/meta/inbound");
    const events = normalizeMetaPayload(
      raw([
        { id: wamid("ph"), from: THREAD, timestamp: String(Math.floor(Date.now() / 1000)), type: "unsupported", unsupported: { type: "media_placeholder" } },
        { id: wamid("rx"), from: THREAD, timestamp: String(Math.floor(Date.now() / 1000)), type: "reaction", reaction: { emoji: "❤️", message_id: wamid("a") } },
      ])
    );
    check("el marcador interno ni siquiera entra a la cola", events.length === 1, events.length);
    await enqueue(events);
    await drainInbox({ budgetMs: 30_000 });
    const reacted = await prisma.messageReaction.findFirst({ where: { message: { externalMessageId: wamid("a") } } });
    check("la reacción queda sobre el mensaje reaccionado (no como mensaje)", reacted?.emoji === "❤️", reacted?.emoji);
    const afterRx = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    check("y no suma no leídos", afterRx.unreadCount === 3, afterRx.unreadCount);
    check("no hay fila del marcador", !(await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("ph") } })));

    console.log("\n8. Reacción, edición y eliminación sobre el mensaje original");
    const ts = () => String(Math.floor(Date.now() / 1000));
    const target = wamid("b"); // «Segundo mensaje» (caso 3)
    await enqueue(
      normalizeMetaPayload(
        raw([
          { id: wamid("r1"), from: THREAD, timestamp: ts(), type: "reaction", reaction: { emoji: "😍", message_id: target } },
          { id: wamid("e1"), from: THREAD, timestamp: ts(), type: "edit", edit: { original_message_id: target, message: { type: "text", text: { body: "Segundo mensaje (corregido)" } } } },
        ])
      )
    );
    await drainInbox({ budgetMs: 30_000 });
    const tgt = await prisma.conversationMessage.findUniqueOrThrow({ where: { externalMessageId: target }, include: { reactions: true } });
    check("la reacción queda en el mensaje, no como mensaje nuevo", tgt.reactions[0]?.emoji === "😍" && !(await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("r1") } })), tgt.reactions);
    check("la edición cambia el texto y guarda el anterior", tgt.body === "Segundo mensaje (corregido)" && tgt.originalBody === "Segundo mensaje" && Boolean(tgt.editedAt), { body: tgt.body, orig: tgt.originalBody });
    await enqueue(
      normalizeMetaPayload(
        raw([
          { id: wamid("r2"), from: THREAD, timestamp: ts(), type: "reaction", reaction: { emoji: "", message_id: target } },
          { id: wamid("v1"), from: THREAD, timestamp: ts(), type: "revoke", revoke: { original_message_id: target } },
          { id: wamid("r3"), from: THREAD, timestamp: ts(), type: "reaction", reaction: { emoji: "👍", message_id: "wamid.no.existe" } },
        ])
      )
    );
    await drainInbox({ budgetMs: 30_000 });
    const tgt2 = await prisma.conversationMessage.findUniqueOrThrow({ where: { externalMessageId: target }, include: { reactions: true } });
    check("quitar la reacción la borra", tgt2.reactions.length === 0, tgt2.reactions);
    check("eliminar para todos marca el original (el texto se conserva)", Boolean(tgt2.revokedAt) && Boolean(tgt2.body), tgt2.revokedAt);
    const orphan = await prisma.conversationMessage.findUnique({ where: { externalMessageId: wamid("r3") } });
    check("reacción a un mensaje que no está: queda como aviso gris", orphan?.kind === "system", orphan?.kind);
  } finally {
    if (prevAi) await prisma.siteSetting.update({ where: { key: prevAi.key }, data: { value: prevAi.value } });
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Cola OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
