/**
 * «Te toca» de WhatsApp: entra lo que necesita a Dayana y sale en cuanto ella
 * contesta (CRM o celular) o pulsa «Listo». Contra la base de DESARROLLO,
 * WhatsApp en modo prueba (no sale nada) y la IA con una espera corta.
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-attention-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Escalada (tope del día) → «Te toca» + aviso; Dayana contesta desde el CRM →
 *    sale, la escalada pasa a pausa humana y el aviso queda leído.
 * 2. Escalada y Dayana contesta desde el celular (eco) → sale.
 * 3. Un eco viejo que llega tarde no la saca; lo que la persona escribió
 *    después de la respuesta sigue tocando.
 * 4. Carrera: Dayana contesta mientras la IA espera → la IA no hace nada.
 * 5. Copiloto: a un «gracias» no se le deja propuesta (usa el modelo).
 * 6. «Listo»: cierra, no cambia el modo, retira la propuesta y deja los avisos
 *    leídos; con un mensaje que aún no se ve, no.
 * 7. Chat en modo Yo: un mensaje que importa abre «Te toca»; un «gracias» no.
 * 8. Los contadores (pestaña, menú, pendientes del CRM) dicen lo mismo.
 * 9. La migración: el relleno sobre filas de prueba (tablas temporales, se deshace).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/db";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { ingestMessage, processNormalizedEvent } from "@/lib/meta/ingest";
import { sendMetaMessage } from "@/lib/meta/send";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { getPendientes } from "@/lib/crm/pendientes";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { pauseAutoReply } from "@/lib/crm/whatsapp-autoreply";
import { proposeForApproval } from "@/lib/crm/whatsapp-agent/approvals";
import { attentionWhere, markAttended, openAttention } from "@/lib/crm/whatsapp-agent/attention";
import { listChats, queueCounts } from "@/lib/crm/whatsapp-agent/workspace";
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
const escalateByHand = async (id: string, category: string, staffId: string) => {
  const c = await conv(id);
  await pauseAutoReply(id, "escalation", { category, severity: "normal", reason: `Prueba: ${category}` });
  await openAttention(id, category as Parameters<typeof openAttention>[1], c.lastInboundAt ?? new Date());
  await emitPlatformNotification({
    eventType: "WHATSAPP_AI_ESCALATED",
    title: `Prueba e2e: te toca (${category})`,
    entityType: "Conversation",
    entityId: id,
    staff: [staffId],
  });
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
  const hasModel = Boolean(process.env.GEMINI_API_KEY?.trim());
  await cleanup();
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER", isActive: true }, select: { id: true } });

  try {
    console.log("\n1. Escalada y Dayana contesta desde el CRM");
    if (!hasModel) {
      console.log("  (omitida: sin GEMINI_API_KEY la IA no llega a escalar)");
    } else {
      const c = await store(T.cap, "Hola", { sentAt: new Date(Date.now() - 2 * 3600_000) });
      // Ya respondió hoy todo lo que puede: la siguiente vez pasa el chat a Dayana.
      for (let i = 0; i < config.maxPerDay; i++) {
        await prisma.conversationMessage.create({
          data: {
            conversationId: c,
            direction: "OUTBOUND",
            status: "SENT",
            body: `Respuesta automática ${i + 1}`,
            isAutoReply: true,
            sentAt: new Date(Date.now() - 90 * 60_000 + i * 60_000),
          },
        });
      }
      await arrive(T.cap, "Necesito hablar con Dayana, es importante");
      const c1 = await conv(c);
      const r1 = await lastRun(c);
      check("la IA escala", r1?.status === "ESCALATED" && c1.aiPausedReason === "escalation", { status: r1?.status, reason: r1?.reason });
      check(
        "le toca desde el mensaje de la persona, por «no sabe qué responder»",
        c1.attentionAt?.getTime() === c1.lastInboundAt?.getTime() && c1.attentionReason === "unknown",
        c1
      );
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

    console.log("\n2. Escalada y Dayana contesta desde el celular");
    {
      const c = await store(T.echo, "Ya hice el pago", { sentAt: new Date(Date.now() - 5 * 60_000) });
      await escalateByHand(c, "payment", staff.id);
      const item = (await listChats({ queue: "attention", take: 600 })).find((i) => i.id === c);
      check("en «Te toca» con su motivo", item?.attention?.reason === "payment", item?.attention);
      await arrive(T.echo, "¡Gracias! Ya lo vi, quedó confirmado.", { isEcho: true, participantName: null });
      const c1 = await conv(c);
      check("el eco la saca de «Te toca»", c1.attentionAt === null && !(await inAttention(c)), c1);
      check("y la escalada pasa a pausa humana", c1.aiPausedReason === "human", c1.aiPausedReason);
      const n = await notices(c);
      check("el aviso queda leído", n.length > 0 && n.every((x) => x.readAt !== null), n);
    }

    console.log("\n3. Ecos en desorden");
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
      check("la escalada ya se atendió: pausa humana", c2.aiPausedReason === "human", c2.aiPausedReason);
      await arrive(T.late, "Te llamo en 5 minutos.", { isEcho: true, participantName: null });
      check("contestar a eso la saca", (await conv(c)).attentionAt === null);
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

    console.log("\n5. Copiloto: «gracias» no deja propuesta");
    if (!hasModel) {
      console.log("  (omitida: necesita el modelo)");
    } else {
      const c = await store(T.thanks, "Hola, ¿cuánto dura una sesión?", { sentAt: new Date(Date.now() - 30 * 60_000) });
      await prisma.conversationMessage.create({
        data: {
          conversationId: c,
          direction: "OUTBOUND",
          status: "SENT",
          body: "Hola, la sesión dura 60 minutos.",
          isAutoReply: true,
          sentAt: new Date(Date.now() - 29 * 60_000),
        },
      });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT" } });
      await arrive(T.thanks, "Muchas gracias 🙏");
      const r = await lastRun(c);
      const c1 = await conv(c);
      check("la IA no propone nada («no hacía falta responder»)", r?.status === "SKIPPED" && r.reason === "trivial", { status: r?.status, reason: r?.reason });
      check("sin propuesta ni «Te toca»", (await awaiting(c)) === 0 && c1.attentionAt === null && !(await inAttention(c)));
      check("sin borrador", c1.draftBody === null, c1.draftBody);
    }

    console.log("\n6. «Listo»");
    {
      const c = await store(T.listo, "Quiero saber si hay cupo este mes", { sentAt: new Date(Date.now() - 10 * 60_000) });
      await prisma.conversation.update({ where: { id: c }, data: { aiMode: "COPILOT" } });
      await escalateByHand(c, "other", staff.id);
      const aiRun = await prisma.whatsAppAiRun.create({ data: { conversationId: c, status: "THINKING" } });
      await proposeForApproval({
        runId: aiRun.id,
        conversationId: c,
        name: "Te toca 06",
        proposal: { kind: "reply", message: "Sí, hay cupo. ¿Te agendo?" },
      });
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

    console.log("\n7. Chat en modo Yo");
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

    console.log("\n8. Los contadores dicen lo mismo");
    {
      const [counts, direct, list, pendientes] = await Promise.all([
        queueCounts(),
        prisma.conversation.count({ where: attentionWhere() }),
        listChats({ queue: "attention", take: 600 }),
        getPendientes(),
      ]);
      const todo = pendientes.find((p) => p.key === "whatsapp-te-toca")?.count ?? 0;
      check("pestaña = menú = consulta", counts.attention === direct, { counts: counts.attention, direct });
      check("la lista trae los mismos", list.length === Math.min(direct, 600), { list: list.length, direct });
      check("los pendientes del CRM cuentan lo mismo", todo === direct, { todo, direct });
    }

    console.log("\n9. La migración (tablas temporales, se deshace)");
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
    .split(/;\s*(?:\n|$)/)
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
  const T0 = new Date(Date.now() - 24 * 3600_000);
  const at = (min: number) => new Date(T0.getTime() + min * 60_000);
  type Row = { id: string; attention_at: Date | null; attention_reason: string | null; ai_paused_reason: string | null; last_human_reply_at: Date | null };
  let rows: Row[] = [];
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
        const conv = (id: string, reason: string | null, pausedAt: Date | null, category: string | null) =>
          tx.$executeRawUnsafe(
            `INSERT INTO pg_temp."conversations" (id, channel, external_thread_id, meta_account_id, ai_paused_reason, ai_paused_at, escalation_category, updated_at)
             VALUES ($1, 'WHATSAPP', $1, 'e2e', $2, $3, $4, now())`,
            id,
            reason,
            pausedAt,
            category
          );
        let m = 0;
        const out = (
          conversationId: string,
          sentAt: Date,
          o: { auto?: boolean; echo?: boolean; source?: string | null; clientKey?: string | null; status?: string; kind?: string }
        ) =>
          tx.$executeRawUnsafe(
            `INSERT INTO pg_temp."conversation_messages" (id, conversation_id, direction, status, body, is_echo, is_auto_reply, source, client_key, kind, sent_at)
             VALUES ($1, $2, 'OUTBOUND', $3::"MessageDeliveryStatus", 'x', $4, $5, $6, $7, $8, $9)`,
            `bf-msg-${++m}`,
            conversationId,
            o.status ?? "SENT",
            Boolean(o.echo),
            Boolean(o.auto),
            o.source ?? null,
            o.clientKey ?? null,
            o.kind ?? "message",
            sentAt
          );

        // A: escalada sin respuesta → le sigue tocando, por «pago».
        await conv("bf-a", "escalation", at(0), "payment");
        // B: escalada y Dayana contestó desde el CRM → sale, pausa humana.
        await conv("bf-b", "escalation", at(0), "clinical");
        await out("bf-b", at(5), {});
        // C: contestó desde el celular (eco).
        await conv("bf-c", "escalation", at(0), "unknown");
        await out("bf-c", at(5), { echo: true });
        // D: después solo hubo IA, masivo, recordatorio, saludo, un fallo y un
        //    aviso; antes, una respuesta suya vieja → le sigue tocando.
        await conv("bf-d", "escalation", at(0), "complaint");
        await out("bf-d", at(-60), {});
        await out("bf-d", at(1), { auto: true });
        await out("bf-d", at(2), { source: "bulk:x" });
        await out("bf-d", at(3), { auto: true, source: "recordatorio:x" });
        await out("bf-d", at(4), { auto: true, clientKey: "welcome:x" });
        await out("bf-d", at(5), { status: "FAILED" });
        await out("bf-d", at(6), { kind: "system" });
        // E: aprobó una propuesta de la IA → cuenta como respuesta suya.
        await conv("bf-e", "escalation", at(0), "booking");
        await out("bf-e", at(5), { auto: true, source: "approval" });
        // F: escalada sin categoría → «revisar» (other).
        await conv("bf-f", "escalation", at(0), null);
        // G: sin escalada: solo se anota la última respuesta.
        await conv("bf-g", "human", at(0), null);
        await out("bf-g", at(5), {});

        for (const s of statements) await tx.$executeRawUnsafe(s);
        rows = await tx.$queryRawUnsafe<Row[]>(
          `SELECT id, attention_at, attention_reason, ai_paused_reason, last_human_reply_at FROM pg_temp."conversations" ORDER BY id`
        );
        throw new Rollback();
      },
      { timeout: 30_000 }
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  const row = (id: string) => rows.find((r) => r.id === id);
  const same = (d: Date | null | undefined, ref: Date) => Boolean(d) && new Date(d!).getTime() === ref.getTime();
  check("A: escalada sin respuesta → le toca desde la escalada, por «payment»", same(row("bf-a")?.attention_at, at(0)) && row("bf-a")?.attention_reason === "payment" && row("bf-a")?.ai_paused_reason === "escalation", row("bf-a"));
  check("B: contestó desde el CRM → sale y pasa a pausa humana", row("bf-b")?.attention_at === null && row("bf-b")?.ai_paused_reason === "human" && same(row("bf-b")?.last_human_reply_at, at(5)), row("bf-b"));
  check("C: contestó desde el celular → sale", row("bf-c")?.attention_at === null && row("bf-c")?.ai_paused_reason === "human", row("bf-c"));
  check("D: IA, masivo, recordatorio, saludo, fallo y aviso no cuentan", same(row("bf-d")?.attention_at, at(0)) && row("bf-d")?.ai_paused_reason === "escalation" && same(row("bf-d")?.last_human_reply_at, at(-60)), row("bf-d"));
  check("E: una propuesta aprobada cuenta como respuesta", row("bf-e")?.attention_at === null && row("bf-e")?.ai_paused_reason === "human", row("bf-e"));
  check("F: sin categoría → «other»", row("bf-f")?.attention_reason === "other", row("bf-f"));
  check("G: sin escalada no le toca; se anota la respuesta", row("bf-g")?.attention_at === null && same(row("bf-g")?.last_human_reply_at, at(5)), row("bf-g"));
  const leftover = await prisma.conversation.count({ where: { id: { startsWith: "bf-" } } });
  check("la base real no cambió", leftover === 0, leftover);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
