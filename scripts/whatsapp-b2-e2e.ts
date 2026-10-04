/**
 * Clasificación de chats dentro de WhatsApp (fase B2): lo personal, de
 * negocio/app o del equipo calla a la IA y no cuenta en «Te toca». Contra la
 * base de DESARROLLO, WhatsApp en modo prueba (no sale nada); no llama al
 * modelo (las etiquetas de la IA se ponen a mano en la base).
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-b2-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Clasificación encendida + «negocio» a mano → la IA no contesta
 *    (`category_negocio`), no saluda, no le toca a Dayana.
 * 2. Chat en modo Yo + «personal» a mano, primer mensaje → sin saludo ni «Te
 *    toca». El mismo caso sin categoría sí saluda y sí le toca (control).
 * 3. La IA dijo «personal» 0,95 → callado (fuera de «Te toca» aunque le tocara);
 *    0,8 «por revisar» → NO callado.
 * 4. Una etiqueta de la IA vieja (la persona escribió después) → no calla.
 * 5. Apagar la clasificación → nada callado: el chat vuelve a «Te toca».
 * 6. «Seguimiento»: encendida, fuera lo callado, clientas y comunidad (sí
 *    interesadas, «otro», lo dudoso y lo sin clasificar); apagada, como antes.
 * 7. Filtros de categoría de «Todos» (también «Otros») y contadores que coinciden.
 * 8. Etiqueta vieja de la IA en la puerta: la IA la vuelve a mirar en el
 *    momento (una llamada; aquí una IA de prueba) y usa lo que diga; si falla
 *    o tarda, no calla. Sin la IA de WhatsApp (modo Yo) o apagada la
 *    clasificación, no se llama a nadie.
 * 9. Un chat callado sigue en «Te toca» por una escalada (clínico, pago) o
 *    algo por aprobar; «sin responder», no (ni la insignia en «Todos»).
 */
import { prisma } from "@/lib/db";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { ingestMessage, processNormalizedEvent } from "@/lib/meta/ingest";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { CLASSIFY_ENABLED_KEY, categoryCounts, reclassifyByRulesNow, setManualCategory } from "@/lib/crm/chat-category";
import { isSilencingCategory } from "@/lib/crm/chat-category-rules";
import { getPendientes } from "@/lib/crm/pendientes";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { getWelcomeConfig, setWelcomeConfig } from "@/lib/crm/whatsapp-welcome";
import { attentionWhere, openAttention } from "@/lib/crm/whatsapp-agent/attention";
import { GATE_AI_TIMEOUT_MS, categoryGate, setGateClassifierForTests } from "@/lib/crm/whatsapp-agent/category-gate";
import { chatCategoryWhere, listChats, queueCounts } from "@/lib/crm/whatsapp-agent/workspace";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
// La IA espera poco a que la persona termine de escribir (se lee al cargar `run.ts`, que es perezoso).
process.env.WHATSAPP_AI_DEBOUNCE_MS ??= "2000";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const T = {
  negocio: "573000009440",
  personalNew: "573000009441",
  control: "573000009442",
  aiSure: "573000009443",
  aiUnsure: "573000009444",
  followPersonal: "573000009445",
  followInteresada: "573000009446",
  unclassified: "573000009447",
  otro: "573000009448",
  followOtro: "573000009449",
  followCliente: "573000009450",
  followReview: "573000009451",
  gateSilence: "573000009452",
  gateFail: "573000009453",
  gateManual: "573000009454",
  quietClinical: "573000009455",
  quietApproval: "573000009456",
};
const THREADS = Object.values(T);

let seq = 0;
const msg = (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId,
  externalMessageId: `wamid.b2.${run}.${++seq}`,
  isEcho: false,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: `B2 ${threadId.slice(-2)}`,
  ...extra,
});

/** Guarda un mensaje sin despertar a la IA. */
const store = async (threadId: string, body: string, extra: Partial<NormalizedMessage> = {}) => {
  const r = await ingestMessage(msg(threadId, body, extra));
  if (r.outcome !== "stored") throw new Error(`no se guardó: ${JSON.stringify(r)}`);
  return r.conversationId;
};
/** Como si llegara por el webhook: guarda y corre la IA. */
const arrive = (threadId: string, body: string) =>
  processNormalizedEvent("whatsapp_business_account", msg(threadId, body));

const conv = (id: string) =>
  prisma.conversation.findUniqueOrThrow({
    where: { id },
    select: { attentionAt: true, attentionReason: true, category: true, categorySource: true, lastMessageAt: true },
  });
const lastRun = (id: string) =>
  prisma.whatsAppAiRun.findFirst({ where: { conversationId: id }, orderBy: { queuedAt: "desc" } });
const outbound = (id: string) => prisma.conversationMessage.count({ where: { conversationId: id, direction: "OUTBOUND" } });
const inAttention = async (id: string) =>
  Boolean((await listChats({ queue: "attention", take: 600 })).find((i) => i.id === id));
const inSeguimiento = async (id: string) =>
  Boolean((await listChats({ queue: "seguimiento", take: 600 })).find((i) => i.id === id));

/** Una etiqueta como la deja la IA, al día con el último mensaje del chat. */
const aiLabel = async (id: string, category: string, confidence: number, review: boolean) => {
  const c = await conv(id);
  await prisma.conversation.update({
    where: { id },
    data: {
      category,
      categorySource: "ai",
      categoryConfidence: confidence,
      categoryReason: "Prueba B2",
      categoryReview: review,
      categorizedAt: new Date(),
      categorizedThroughAt: c.lastMessageAt,
    },
  });
};

const setClassify = (enabled: boolean) =>
  prisma.siteSetting.upsert({
    where: { key: CLASSIFY_ENABLED_KEY },
    create: { key: CLASSIFY_ENABLED_KEY, value: String(enabled) },
    update: { value: String(enabled) },
  });

/** Pestaña = menú = consulta = lista = pendientes del CRM. */
const countersAgree = async (label: string) => {
  const [counts, direct, list, pendientes] = await Promise.all([
    queueCounts(),
    attentionWhere().then((where) => prisma.conversation.count({ where })),
    listChats({ queue: "attention", take: 600 }),
    getPendientes(),
  ]);
  const todo = pendientes.find((p) => p.key === "whatsapp-te-toca")?.count ?? 0;
  check(
    `${label}: los contadores coinciden`,
    counts.attention === direct && list.length === Math.min(direct, 600) && todo === direct,
    { tab: counts.attention, direct, list: list.length, todo }
  );
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
  const keys = ["whatsapp.provider", "whatsapp.autoreply.enabled", "whatsapp.ai", "whatsapp.welcome", CLASSIFY_ENABLED_KEY];
  const saved = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  const base = await getWhatsAppAiConfig();
  await setWhatsAppAiConfig({
    ...base,
    defaultMode: "AUTO",
    schedule: { ...base.schedule, mode: "always" },
    audience: { skipKnownContacts: false, skipCustomers: false },
  });
  await setWelcomeConfig({ ...(await getWelcomeConfig()), isActive: true });
  await setClassify(true);
  await cleanup();
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER", isActive: true }, select: { id: true } });
  const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());

  try {
    console.log("\n1. «Negocio» a mano: la IA no contesta y no le toca a Dayana");
    if (!hasKey) {
      console.log("  (omitida: sin GEMINI_API_KEY la IA no llega a mirar la categoría)");
    } else {
      const a = await store(T.negocio, "Hola", { sentAt: new Date(Date.now() - 2 * 3600_000) });
      await setManualCategory(a, "negocio", staff.id);
      const before = await outbound(a);
      // Un mensaje cualquiera: lo que calla es la marca a mano, no lo que dice.
      await arrive(T.negocio, "Hola, ¿me cuentas cuánto cuesta una sesión?");
      const r = await lastRun(a);
      check("la IA se salta el chat por su categoría", r?.status === "SKIPPED" && r.reason === "category_negocio", { status: r?.status, reason: r?.reason });
      check("no se envía nada (ni saludo)", (await outbound(a)) === before);
      check("no le toca a Dayana", (await conv(a)).attentionAt === null && !(await inAttention(a)));
    }

    console.log("\n2. Modo Yo + «personal» a mano, primer mensaje");
    {
      const create = (threadId: string) =>
        prisma.conversation.create({
          data: {
            channel: "WHATSAPP",
            externalThreadId: threadId,
            metaAccountId: "test-phone-id",
            participantName: `B2 ${threadId.slice(-2)}`,
            aiMode: "MANUAL",
            lastInboundAt: null,
          },
          select: { id: true },
        });
      const p = await create(T.personalNew);
      await setManualCategory(p.id, "personal", staff.id);
      await arrive(T.personalNew, "Hola, ¿cómo estás? ¿Nos vemos el domingo?");
      check("sin saludo de bienvenida", (await outbound(p.id)) === 0);
      check("y no le toca a Dayana", (await conv(p.id)).attentionAt === null && !(await inAttention(p.id)));

      const ctl = await create(T.control);
      await arrive(T.control, "Hola, ¿cómo estás? ¿Nos vemos el domingo?");
      check("control sin categoría: sí saluda", (await outbound(ctl.id)) === 1);
      check("y sí le toca a Dayana", (await conv(ctl.id)).attentionReason === "unanswered" && (await inAttention(ctl.id)));
    }

    console.log("\n3. Etiquetas de la IA");
    const sure = await store(T.aiSure, "Hola prima, ¿vienes a la cena?", { sentAt: new Date(Date.now() - 30 * 60_000) });
    await aiLabel(sure, "personal", 0.95, false);
    await openAttention(sure, "unanswered", new Date(Date.now() - 30 * 60_000));
    const unsure = await store(T.aiUnsure, "Hola, ¿qué tal todo?", { sentAt: new Date(Date.now() - 30 * 60_000) });
    await aiLabel(unsure, "personal", 0.8, true);
    await openAttention(unsure, "unanswered", new Date(Date.now() - 30 * 60_000));
    {
      const r = await reclassifyByRulesNow(sure);
      check("«personal» 0,95 de la IA: calla", r?.silencing === true, r);
      check("y no está en «Te toca» aunque le tocara", !(await inAttention(sure)));
      const u = await reclassifyByRulesNow(unsure);
      check("«personal» 0,8 por revisar: NO calla", u?.silencing === false, u);
      check("y sí está en «Te toca»", await inAttention(unsure));
      await countersAgree("encendida");
    }

    console.log("\n4. Etiqueta vieja (la persona escribió después)");
    {
      await store(T.aiSure, "Por cierto, ¿cuánto cuesta una sesión?");
      const r = await reclassifyByRulesNow(sure);
      check("ya no calla (la IA lo tiene que volver a mirar)", r?.stale === true && r.silencing === false, r);
      check("y vuelve a «Te toca» (lo que la IA hará es contestarle)", await inAttention(sure));
      await aiLabel(sure, "personal", 0.95, false);
      check("al volver a mirarlo la IA, calla otra vez", !(await inAttention(sure)));
    }

    console.log("\n5. Apagar la clasificación");
    {
      await setClassify(false);
      const r = await reclassifyByRulesNow(sure);
      check("nada calla", r?.silencing === false, r);
      check("el chat vuelve a «Te toca»", await inAttention(sure));
      const row = await prisma.conversation.findUniqueOrThrow({ where: { id: sure } });
      check("la etiqueta se queda (solo informa)", row.category === "personal" && !isSilencingCategory(row, { enabled: false }));
      await countersAgree("apagada");
      await setClassify(true);
    }

    console.log("\n6. «Seguimiento»");
    {
      const old = new Date(Date.now() - 3 * 24 * 3600_000);
      const fp = await store(T.followPersonal, "Hola, ¿cómo va todo?", { sentAt: old });
      await aiLabel(fp, "personal", 0.95, false);
      const fi = await store(T.followInteresada, "Me interesa la terapia, ¿cómo funciona?", { sentAt: old });
      await aiLabel(fi, "interesada", 0.9, false);
      const fo = await store(T.followOtro, "Hola", { sentAt: old });
      await aiLabel(fo, "otro", 0.9, false);
      const fc = await store(T.followCliente, "Gracias por la sesión", { sentAt: old });
      await aiLabel(fc, "cliente", 0.95, false);
      const fr = await store(T.followReview, "Hola, ¿qué tal?", { sentAt: old });
      await aiLabel(fr, "personal", 0.8, true);
      check("encendida: la interesada sí", await inSeguimiento(fi));
      check("encendida: lo personal no", !(await inSeguimiento(fp)));
      check("encendida: «otro» sí", await inSeguimiento(fo));
      check("encendida: lo dudoso («revisar») sí", await inSeguimiento(fr));
      check("encendida: la clienta no", !(await inSeguimiento(fc)));
      await setClassify(false);
      check("apagada: como antes, las dos", (await inSeguimiento(fi)) && (await inSeguimiento(fp)));
      await setClassify(true);
    }

    console.log("\n7. Filtros de categoría en «Todos»");
    {
      const u = await store(T.unclassified, "Hola");
      const has = async (category: Parameters<typeof listChats>[0]["category"], id: string) =>
        Boolean((await listChats({ queue: "all", category, take: 600 })).find((i) => i.id === id));
      check("«Personales» trae el de la IA", await has("personal", sure));
      check("«Revisar» trae el dudoso", await has("review", unsure));
      check("«Sin clasificar» trae el que nadie miró", await has("unclassified", u));
      check("«Clientes» no trae lo personal", !(await has("cliente", sure)));
      const o = await store(T.otro, "Hola");
      await aiLabel(o, "otro", 0.9, false);
      check("«Otros» trae el de categoría «otro»", await has("otro", o));
      check("y no queda en «Sin clasificar»", !(await has("unclassified", o)));
      check(
        "Personas filtra igual (mismo where)",
        (await prisma.conversation.count({ where: { id: o, ...chatCategoryWhere("otro") } })) === 1
      );
      check("el contador de «Otros» lo cuenta (el chip se ve)", (await categoryCounts()).counts.otro >= 1);
      const item = (await listChats({ queue: "all", category: "review", take: 600 })).find((i) => i.id === unsure);
      check("la fila lleva su categoría y el punto de «revisar»", item?.category === "personal" && item.categoryReview === true, item);
    }

    console.log("\n8. Etiqueta vieja de la IA en la puerta");
    {
      let calls = 0;
      const verdict = (category: "personal" | "interesada", confidence: number) => async () => {
        calls++;
        return { category, confidence, reason: "IA de prueba", review: false, model: "prueba", latencyMs: 1, inputTokens: null, outputTokens: null };
      };
      const stale = async (threadId: string) => {
        const id = await store(threadId, "Hola prima", { sentAt: new Date(Date.now() - 60 * 60_000) });
        await aiLabel(id, "personal", 0.95, false);
        await store(threadId, "¿Y entonces el domingo?");
        return id;
      };

      const s = await stale(T.gateSilence);
      check("la etiqueta quedó vieja", (await reclassifyByRulesNow(s))?.stale === true);
      setGateClassifierForTests(verdict("personal", 0.96));
      calls = 0;
      if (hasKey) {
        const before = await outbound(s);
        await arrive(T.gateSilence, "¿Me confirmas?");
        const r = await lastRun(s);
        check("la IA lo vuelve a mirar en la puerta y calla", r?.status === "SKIPPED" && r.reason === "category_personal", { status: r?.status, reason: r?.reason });
        check("una sola llamada a la IA en esa vuelta", calls === 1, calls);
        check("no se envía nada", (await outbound(s)) === before);
        const row = await prisma.conversation.findUniqueOrThrow({
          where: { id: s },
          select: { categorizedThroughAt: true, lastInboundAt: true, categoryConfidence: true },
        });
        check(
          "la etiqueta queda al día",
          Boolean(row.categorizedThroughAt && row.lastInboundAt && row.categorizedThroughAt >= row.lastInboundAt) && row.categoryConfidence === 0.96,
          row
        );
      } else {
        check("la puerta calla con lo que diga la IA", (await categoryGate(s)({ allowAi: true })) === "personal");
      }

      const f = await stale(T.gateFail);
      setGateClassifierForTests(async () => {
        calls++;
        throw Object.assign(new Error("billing"), { statusCode: 403 });
      });
      calls = 0;
      check("si la IA falla, no calla", (await categoryGate(f)({ allowAi: true })) === null && calls === 1, calls);
      setGateClassifierForTests(verdict("interesada", 0.9));
      check("si la IA dice otra cosa, no calla", (await categoryGate(f)({ allowAi: true })) === null);
      await aiLabel(f, "personal", 0.95, false);
      await store(T.gateFail, "¿Sigues ahí?");
      setGateClassifierForTests(() => new Promise(() => undefined));
      const t0 = Date.now();
      check(
        "si la IA tarda, no calla (y no espera más de la cuenta)",
        (await categoryGate(f)({ allowAi: true })) === null && Date.now() - t0 < GATE_AI_TIMEOUT_MS + 4_000,
        Date.now() - t0
      );

      // Sin la IA de WhatsApp en el chat (modo Yo) o con la clasificación apagada: nadie llama a la IA.
      setGateClassifierForTests(verdict("personal", 0.96));
      const m = await stale(T.gateManual);
      await prisma.conversation.update({ where: { id: m }, data: { aiMode: "MANUAL" } });
      calls = 0;
      await arrive(T.gateManual, "Hola otra vez");
      check("modo Yo: no se llama a la IA para clasificar", calls === 0, calls);
      check("sin llamar a la IA, una etiqueta vieja no calla (le toca)", await inAttention(m));
      await setClassify(false);
      calls = 0;
      check("apagada: no se mira nada", (await categoryGate(m)({ allowAi: true })) === null && calls === 0);
      await setClassify(true);
      setGateClassifierForTests(null);
    }

    console.log("\n9. Un chat callado y «Te toca»");
    {
      const c = await store(T.quietClinical, "No puedo más", { sentAt: new Date(Date.now() - 20 * 60_000) });
      await setManualCategory(c, "personal", staff.id);
      await openAttention(c, "unanswered", new Date(Date.now() - 20 * 60_000));
      check("«sin responder» en un chat callado: no le toca", !(await inAttention(c)));
      const row = (await listChats({ queue: "all", take: 600 })).find((i) => i.id === c);
      check("y en «Todos» no lleva la insignia de «Te toca»", row?.attention === null, row?.attention);
      await openAttention(c, "clinical");
      check("una escalada clínica sí le toca aunque esté callado", await inAttention(c));
      const row2 = (await listChats({ queue: "all", take: 600 })).find((i) => i.id === c);
      check("con su insignia", row2?.attention?.reason === "clinical", row2?.attention);

      const a = await store(T.quietApproval, "Ya pagué", { sentAt: new Date(Date.now() - 20 * 60_000) });
      await setManualCategory(a, "negocio", staff.id);
      check("callado y sin nada: no le toca", !(await inAttention(a)));
      await prisma.whatsAppAiRun.create({
        data: { conversationId: a, status: "AWAITING_APPROVAL", proposal: { kind: "reply", message: "Gracias", reason: "Prueba B2" } },
      });
      check("algo por aprobar sí le toca aunque esté callado", await inAttention(a));
      await countersAgree("callados con escaladas");
    }
  } finally {
    setGateClassifierForTests(null);
    await cleanup();
    for (const key of keys) {
      const prev = saved.find((s) => s.key === key);
      if (prev) await prisma.siteSetting.update({ where: { key }, data: { value: prev.value } });
      else await prisma.siteSetting.deleteMany({ where: { key } });
    }
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Clasificación en WhatsApp OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
