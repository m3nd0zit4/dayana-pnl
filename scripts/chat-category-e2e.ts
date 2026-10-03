/**
 * Clasificación de chats de WhatsApp. Contra la base de DESARROLLO, sin enviar
 * nada; la parte dudosa llama de verdad al modelo Flash-Lite (centavos).
 *
 *   bun scripts/chat-category-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Un chat por categoría: cliente (pagó), interesada (autoevaluación),
 *    comunidad (masterclass + «gracias»), personal (libreta), negocio (código),
 *    equipo (Ajustes → equipo), otro (nunca escribió) — todos por reglas.
 * 2. Dos chats dudosos los decide la IA (fuente `ai`, modelo real).
 * 3. Una categoría manual sobrevive a «volver a clasificar» y a «clasificar todo».
 * 4. Un mensaje nuevo lo vuelve a mirar; uno nuestro no vuelve a pagar a la IA.
 * 5. Los contadores cuadran.
 * 6. Sacar un número del equipo lo vuelve a clasificar.
 * 7. Un 403 de facturación de Google (simulado) para la IA en esa vuelta sin
 *    marcar nada; las reglas siguen. Si la IA real está bloqueada así, sus
 *    comprobaciones salen SKIPPED («IA bloqueada por facturación de Google»);
 *    cualquier otro error de la IA falla.
 */
import { APICallError } from "ai";

import { prisma } from "@/lib/db";
import {
  TEAM_PHONES_KEY,
  categoryCounts,
  classifyConversation,
  classifyPending,
  pendingClassificationWhere,
  setManualCategory,
  setTeamPhones,
  type ClassifyOutcome,
} from "@/lib/crm/chat-category";
import { classifierModelId } from "@/lib/crm/chat-category-ai";
import { CHAT_CATEGORIES } from "@/lib/crm/chat-category-rules";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};
/** Solo para lo que necesita la IA viva cuando Google la bloquea por facturación. */
const skipped: string[] = [];
const AI_BILLING = "IA bloqueada por facturación de Google";
const skip = (name: string) => {
  console.log(`  ⏭️  ${name} — SKIPPED: ${AI_BILLING}`);
  skipped.push(name);
};
let aiBlocked = false;

const run = Date.now();
const T = {
  cliente: "573000009401",
  interesada: "573000009402",
  comunidad: "573000009403",
  personal: "573000009404",
  negocio: "573000009405",
  equipo: "573000009406",
  otro: "573000009407",
  manual: "573000009408",
  aiInterest: "573000009409",
  aiVendor: "573000009410",
  billing1: "573000009411",
  billing2: "573000009412",
  billing3: "573000009413",
} as const;
const THREADS = Object.values(T);
const DIAG_TOKEN = `e2e-clasif-${run}`;
const WEBINAR_SLUG = `e2e-clasif-${run}`;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

type Msg = { dir: "INBOUND" | "OUTBOUND"; body: string; source?: string; isEcho?: boolean };
const createChat = async (thread: string, name: string, msgs: Msg[], contactId?: string) => {
  const sent = msgs.map((m, i) => ({ ...m, at: minutesAgo(msgs.length - i) }));
  const lastInbound = sent.filter((m) => m.dir === "INBOUND").at(-1)?.at ?? null;
  const conv = await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: thread,
      metaAccountId: "test-phone-id",
      participantName: name,
      contactId: contactId ?? null,
      aiMode: "MANUAL",
      lastMessageAt: sent.at(-1)?.at ?? new Date(),
      lastInboundAt: lastInbound,
      messages: {
        create: sent.map((m, i) => ({
          direction: m.dir,
          status: m.dir === "INBOUND" ? "RECEIVED" : "SENT",
          externalMessageId: `wamid.clasif.${run}.${thread}.${i}`,
          body: m.body,
          source: m.source ?? null,
          isEcho: m.isEcho ?? false,
          sentAt: m.at,
        })),
      },
    },
    select: { id: true },
  });
  return conv.id;
};

const addMessage = async (conversationId: string, m: Msg) => {
  const at = new Date();
  await prisma.conversationMessage.create({
    data: {
      conversationId,
      direction: m.dir,
      status: m.dir === "INBOUND" ? "RECEIVED" : "SENT",
      externalMessageId: `wamid.clasif.${run}.extra.${at.getTime()}.${Math.random().toString(36).slice(2, 8)}`,
      body: m.body,
      source: m.source ?? null,
      sentAt: at,
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: at, ...(m.dir === "INBOUND" ? { lastInboundAt: at } : {}) },
  });
};

const state = (id: string) =>
  prisma.conversation.findUniqueOrThrow({
    where: { id },
    select: {
      category: true,
      categorySource: true,
      categoryConfidence: true,
      categoryReason: true,
      categoryReview: true,
      categorizedThroughAt: true,
      lastMessageAt: true,
    },
  });

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.auditLog.deleteMany({ where: { entityType: "ConversationCategory", entityId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await prisma.diagnostic.deleteMany({ where: { token: { startsWith: "e2e-clasif-" } } });
  await prisma.contact.deleteMany({ where: { phoneE164: { in: THREADS.map((t) => `+${t}`) } } });
  await prisma.freeWebinar.deleteMany({ where: { slug: { startsWith: "e2e-clasif-" } } });
  await prisma.whatsAppKnownContact.deleteMany({ where: { phone: { in: THREADS } } });
};

const main = async () => {
  await cleanup();
  const prevTeam = await prisma.siteSetting.findUnique({ where: { key: TEAM_PHONES_KEY } });
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER" }, select: { id: true } });
  const aiStats: { model?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null }[] = [];

  try {
    // ── Datos del CRM ──────────────────────────────────────────────────
    const product = await prisma.product.findFirstOrThrow({ where: { kind: "THERAPY" }, select: { id: true } });
    const contact = (thread: string, firstName: string) =>
      prisma.contact.create({ data: { phoneE164: `+${thread}`, firstName, source: "WHATSAPP_DIRECT" }, select: { id: true } });

    const cCliente = await contact(T.cliente, "Clienta E2E");
    await prisma.enrollment.create({
      data: { contactId: cCliente.id, productId: product.id, status: "ACTIVE", amountMinor: 50_000, currency: "USD" },
    });
    const cInteresada = await contact(T.interesada, "Interesada E2E");
    await prisma.diagnostic.create({ data: { token: DIAG_TOKEN, contactId: cInteresada.id, completedAt: new Date() } });
    const cComunidad = await contact(T.comunidad, "Comunidad E2E");
    // Realizado y del año 2000: nunca pasa a ser «el evento actual» de otras
    // pruebas que corren a la vez en la base compartida.
    const longAgo = new Date(Date.UTC(2000, 0, 1));
    const webinar = await prisma.freeWebinar.create({
      data: {
        slug: WEBINAR_SLUG,
        headline: "Masterclass de prueba (clasificación)",
        learnItems: [],
        status: "COMPLETED",
        startsAt: longAgo,
        endedAt: longAgo,
      },
      select: { id: true },
    });
    await prisma.webinarRegistration.create({ data: { webinarId: webinar.id, contactId: cComunidad.id } });
    await prisma.whatsAppKnownContact.create({ data: { phone: T.personal, name: "Tía E2E" } });
    await setTeamPhones([...(prevTeam ? JSON.parse(prevTeam.value) : []), `+${T.equipo}`], staff.id);

    // ── Chats ──────────────────────────────────────────────────────────
    const ids = {
      cliente: await createChat(T.cliente, "Clienta", [
        { dir: "INBOUND", body: "Hola Dayana, ¿me confirmas la sesión del jueves?" },
        { dir: "OUTBOUND", body: "Sí, el jueves a las 5 💛" },
      ], cCliente.id),
      interesada: await createChat(T.interesada, "Interesada", [
        { dir: "OUTBOUND", body: "Hola, te bendigo 💛 Leí tu autoevaluación…", source: "autoevaluacion" },
      ], cInteresada.id),
      comunidad: await createChat(T.comunidad, "Comunidad", [
        { dir: "OUTBOUND", body: "Hoy es la masterclass a las 7 pm 💛", source: "bulk:e2e" },
        { dir: "INBOUND", body: "Muchas gracias Dayana 🙏 ahí estaré" },
        { dir: "INBOUND", body: "Bendiciones, me encantó la clase ❤️" },
      ], cComunidad.id),
      personal: await createChat(T.personal, "Tía", [
        { dir: "INBOUND", body: "Mija, ¿vienes el domingo al almuerzo?" },
        { dir: "OUTBOUND", body: "Sí tía, allá llego", isEcho: true },
      ]),
      negocio: await createChat(T.negocio, "Verificación", [
        { dir: "INBOUND", body: "Tu código de verificación es 482913. No lo compartas con nadie." },
      ]),
      equipo: await createChat(T.equipo, "Asistente", [{ dir: "INBOUND", body: "Ya subí el video editado al drive" }]),
      otro: await createChat(T.otro, "Invitada", [{ dir: "OUTBOUND", body: "Hola, ¿cómo vas?", isEcho: true }]),
      manual: await createChat(T.manual, "Manual", [
        { dir: "INBOUND", body: "Tu código de seguridad es 771204" },
      ]),
      aiInterest: await createChat(T.aiInterest, "Lucía", [
        { dir: "INBOUND", body: "Hola! Vi tu video sobre la ansiedad en TikTok. ¿Cómo funcionan tus sesiones y cuánto cuestan?" },
      ]),
      aiVendor: await createChat(T.aiVendor, "Carolina", [
        {
          dir: "INBOUND",
          body: "Hola Dayana, soy Carolina de una agencia de marketing digital. Ayudamos a coaches a conseguir más pacientes con anuncios en Instagram. ¿Te puedo enviar una propuesta?",
        },
      ]),
    };

    console.log("\n1. Reglas: un chat por categoría");
    const expected: [keyof typeof ids, string, string][] = [
      ["cliente", "cliente", "Pagó un paquete"],
      ["interesada", "interesada", "Hizo la autoevaluación"],
      ["comunidad", "comunidad", "Se inscribió a un evento y solo agradece o saluda"],
      ["personal", "personal", "Está en la libreta del celular"],
      ["negocio", "negocio", "Código de verificación"],
      ["equipo", "equipo", "Número del equipo"],
      ["otro", "otro", "Nunca escribió: solo le escribimos nosotros"],
    ];
    for (const [key, category, reason] of expected) {
      const out = await classifyConversation(ids[key]);
      const s = await state(ids[key]);
      check(
        `${key} → ${category} por regla («${reason}»)`,
        out.status === "classified" && s.category === category && s.categorySource === "rule" && s.categoryReason === reason,
        { out, s }
      );
    }
    const equipoState = await state(ids.equipo);
    check("la regla no pide «revisar»", !equipoState.categoryReview);
    check("cubre hasta el último mensaje", equipoState.categorizedThroughAt?.getTime() === equipoState.lastMessageAt.getTime());

    console.log("\n2. Manual: gana siempre");
    await setManualCategory(ids.manual, "personal", staff.id);
    let m = await state(ids.manual);
    check("se guardó como manual", m.category === "personal" && m.categorySource === "manual" && !m.categoryReview, m);
    const audit = await prisma.auditLog.count({ where: { entityType: "ConversationCategory", entityId: ids.manual } });
    check("queda en el registro de auditoría", audit === 1, audit);
    const forced = await classifyConversation(ids.manual, { force: true });
    m = await state(ids.manual);
    check("«volver a clasificar» no lo pisa", forced.status === "skipped" && m.category === "personal" && m.categorySource === "manual", {
      forced,
      m,
    });
    await addMessage(ids.manual, { dir: "INBOUND", body: "Tu código de seguridad es 990011" });
    const pendingIds = (await prisma.conversation.findMany({ where: pendingClassificationWhere(), select: { id: true } })).map(
      (c) => c.id
    );
    check("con un mensaje nuevo no entra en la cola de pendientes", !pendingIds.includes(ids.manual));

    console.log(`\n3. IA (${classifierModelId()}) para los dudosos`);
    const aiOutcomes: Record<string, ClassifyOutcome> = {};
    for (const key of ["aiInterest", "aiVendor"] as const) {
      const out = await classifyConversation(ids[key]);
      aiOutcomes[key] = out;
      if (out.status === "classified") aiStats.push(out);
      console.log(`     ${key}: ${JSON.stringify(out)}`);
    }
    const ai1 = aiOutcomes.aiInterest;
    const ai2 = aiOutcomes.aiVendor;
    // Solo el 403 de facturación de Google se salta; cualquier otro error falla.
    aiBlocked = [ai1, ai2].some((o) => o.status === "error" && o.aiBlocked === "billing");
    if (aiBlocked) {
      skip("pregunta por sesiones y precio → interesada (IA)");
      skip("agencia ofreciendo anuncios → negocio (IA)");
      skip("guarda confianza, motivo corto y «revisar» si < 0,7");
      for (const key of ["aiInterest", "aiVendor"] as const) {
        const o = aiOutcomes[key];
        check(`${key}: el error es exactamente el 403 de facturación`, o.status === "error" && o.aiBlocked === "billing", o);
        const s = await state(ids[key]);
        check(`${key}: con la IA bloqueada el chat queda sin tocar`, s.category === null && s.categorizedThroughAt === null, s);
      }
    } else {
      check(
        "pregunta por sesiones y precio → interesada (IA)",
        ai1.status === "classified" && ai1.source === "ai" && ai1.category === "interesada",
        ai1
      );
      check(
        "agencia ofreciendo anuncios → negocio (IA)",
        ai2.status === "classified" && ai2.source === "ai" && (ai2.category === "negocio" || ai2.category === "otro"),
        ai2
      );
      for (const key of ["aiInterest", "aiVendor"] as const) {
        const s = await state(ids[key]);
        check(
          `${key}: guarda confianza, motivo corto y «revisar» si < 0,7`,
          s.categorySource === "ai" &&
            typeof s.categoryConfidence === "number" &&
            (s.categoryReason?.length ?? 0) > 0 &&
            (s.categoryReason?.length ?? 0) <= 120 &&
            s.categoryReview === (s.categoryConfidence ?? 0) < 0.7,
          s
        );
      }
    }

    console.log("\n4. Mensajes nuevos");
    await addMessage(ids.aiInterest, { dir: "OUTBOUND", body: "¡Hola Lucía! Te cuento…" });
    if (aiBlocked) {
      skip("un mensaje nuestro no vuelve a llamar a la IA (se conserva)");
    } else {
      const keptOut = await classifyConversation(ids.aiInterest);
      check("un mensaje nuestro no vuelve a llamar a la IA (se conserva)", keptOut.status === "classified" && keptOut.kept === true, keptOut);
    }
    await addMessage(ids.otro, { dir: "INBOUND", body: "Tu código de acceso es 55821" });
    const again = await classifyConversation(ids.otro);
    check("«otro» que escribe un código → negocio", again.status === "classified" && again.category === "negocio", again);
    const upToDate = await classifyConversation(ids.otro);
    check("sin nada nuevo no se vuelve a mirar", upToDate.status === "skipped" && upToDate.reason === "up_to_date", upToDate);

    console.log("\n5. «Clasificar todo» y contadores");
    // Solo los chats de prueba: la base de desarrollo es compartida y la IA cuesta.
    const own = Object.values(ids);
    await prisma.conversation.update({ where: { id: ids.comunidad }, data: { categorizedThroughAt: null } });
    let rounds = 0;
    let progress = await classifyPending({ limit: 40, budgetMs: 45_000, ids: own });
    rounds++;
    while (progress.remaining > 0 && progress.classified > 0 && !progress.aiBlocked && rounds < 5) {
      progress = await classifyPending({ limit: 40, budgetMs: 45_000, ids: own });
      rounds++;
    }
    check("«clasificar todo» no toca la manual ni falla", progress.skipped === 0 && progress.failed === 0, progress);
    const ownPending = await prisma.conversation.findMany({
      where: { id: { in: own }, ...pendingClassificationWhere() },
      select: { id: true },
    });
    if (aiBlocked) {
      check("la tanda avisa que la IA está bloqueada por facturación", progress.aiBlocked === "billing", progress);
      check(
        "solo quedan pendientes los dos dudosos (esperan a la IA); las reglas siguieron",
        ownPending.length === 2 &&
          ownPending.every((p) => p.id === ids.aiInterest || p.id === ids.aiVendor) &&
          progress.needsAi === 2 &&
          progress.byRule >= 1,
        { ownPending, progress }
      );
      skip("no queda ninguno de los de prueba pendiente");
    } else {
      check("no queda ninguno de los de prueba pendiente", ownPending.length === 0, ownPending);
    }
    check("comunidad sigue en comunidad", (await state(ids.comunidad)).category === "comunidad");
    m = await state(ids.manual);
    check("la manual sobrevive a «clasificar todo»", m.category === "personal" && m.categorySource === "manual", m);

    const counts = await categoryCounts();
    const sum = CHAT_CATEGORIES.reduce((a, c) => a + counts.counts[c], 0);
    check("categorías + sin clasificar = total", sum + counts.unclassified === counts.total, counts);
    const direct = await prisma.conversation.count({ where: { channel: "WHATSAPP", category: "equipo" } });
    check("el contador de «equipo» cuadra con la base", counts.counts.equipo === direct, { counts: counts.counts.equipo, direct });
    const unclassified = await prisma.conversation.count({ where: { channel: "WHATSAPP", category: null } });
    check("el contador de «sin clasificar» cuadra con la base", counts.unclassified === unclassified, {
      counts: counts.unclassified,
      unclassified,
    });
    check("cuenta las manuales", counts.manual >= 1, counts.manual);
    check("el equipo guardado incluye el número de prueba", counts.teamPhones.includes(`+${T.equipo}`), counts.teamPhones);

    console.log("\n6. Sacar un número del equipo lo vuelve a clasificar");
    const restored = prevTeam ? (JSON.parse(prevTeam.value) as string[]) : [];
    const res = await setTeamPhones(restored, staff.id);
    const eq = await state(ids.equipo);
    // Puede que la IA, leyendo «subí el video editado», diga «equipo» por su
    // cuenta: lo que se comprueba es que ya no sale de la regla del número.
    check(
      "ya no es «equipo» por el número",
      res.reclassified.length >= 1 && eq.categoryReason !== "Número del equipo",
      { res: res.reclassified, eq }
    );
    if (aiBlocked) {
      check("con la IA bloqueada queda sin clasificar (se reintenta luego)", eq.category === null, eq);
    } else if (eq.categorySource === "ai") {
      const out = res.reclassified.find((o) => o.id === ids.equipo);
      if (out?.status === "classified") aiStats.push(out);
    }

    console.log("\n7. 403 de facturación de Google (simulado): la vuelta sigue con reglas y no marca nada");
    const b = {
      dudosa1: await createChat(T.billing1, "Dudosa 1", [{ dir: "INBOUND", body: "Hola, ¿me puedes contar algo?" }]),
      dudosa2: await createChat(T.billing2, "Dudosa 2", [{ dir: "INBOUND", body: "Buenas, una consulta" }]),
      codigo: await createChat(T.billing3, "Código", [{ dir: "INBOUND", body: "Tu código de verificación es 330145" }]),
    };
    const bIds = Object.values(b);
    let calls = 0;
    const billing = await classifyPending({
      ids: bIds,
      concurrency: 1,
      budgetMs: 30_000,
      classifier: async () => {
        calls++;
        throw new APICallError({
          message: "Lightning dunning decision is deny for project: projects/000000000000",
          url: "https://generativelanguage.googleapis.com",
          requestBodyValues: {},
          statusCode: 403,
        });
      },
    });
    check("la tanda dice «bloqueada por facturación»", billing.aiBlocked === "billing", billing);
    check("deja de llamar a la IA tras el primer 403", calls === 1, calls);
    check("no lo cuenta como fallo; los dudosos esperan a la IA", billing.failed === 0 && billing.needsAi === 2, billing);
    check("las reglas siguen: el código queda como negocio", (await state(b.codigo)).category === "negocio");
    for (const key of ["dudosa1", "dudosa2"] as const) {
      const s = await state(b[key]);
      check(`${key}: sin tocar (sigue pendiente)`, s.category === null && s.categorizedThroughAt === null, s);
    }
    const stillPending = await prisma.conversation.count({ where: { id: { in: bIds }, ...pendingClassificationWhere() } });
    check("los dos dudosos siguen en la cola para la próxima vuelta", stillPending === 2 && billing.remaining === 2, {
      stillPending,
      remaining: billing.remaining,
    });

    let otherCalls = 0;
    const quota = await classifyPending({
      ids: bIds,
      concurrency: 1,
      budgetMs: 30_000,
      classifier: async () => {
        otherCalls++;
        throw new APICallError({ message: "Resource has been exhausted", url: "x", requestBodyValues: {}, statusCode: 429 });
      },
    });
    check(
      "otro error (429) sí es un fallo y no se toma por facturación",
      quota.aiBlocked === null && quota.failed === 2 && otherCalls === 2,
      quota
    );
  } finally {
    await cleanup();
    if (prevTeam) {
      await prisma.siteSetting.upsert({
        where: { key: TEAM_PHONES_KEY },
        create: { key: TEAM_PHONES_KEY, value: prevTeam.value },
        update: { value: prevTeam.value },
      });
    } else {
      await prisma.siteSetting.deleteMany({ where: { key: TEAM_PHONES_KEY } });
    }
    await prisma.auditLog.deleteMany({ where: { entityType: "SiteSetting", entityId: TEAM_PHONES_KEY, createdAt: { gte: new Date(run) } } });
  }

  if (aiStats.length) {
    const input = aiStats.reduce((a, s) => a + (s.inputTokens ?? 0), 0);
    const output = aiStats.reduce((a, s) => a + (s.outputTokens ?? 0), 0);
    const latencies = aiStats.map((s) => s.latencyMs ?? 0);
    console.log(
      `\nIA: ${aiStats.length} llamadas · modelo ${[...new Set(aiStats.map((s) => s.model))].join(", ")} · ` +
        `latencia ${Math.min(...latencies)}–${Math.max(...latencies)} ms · tokens ${input} entrada / ${output} salida`
    );
  }

  if (skipped.length) console.log(`\n⏭️  ${skipped.length} comprobación(es) SKIPPED: ${AI_BILLING} (403).`);
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallo(s):\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log(
    skipped.length
      ? `\n✅ Clasificación de chats: todo bien, salvo la IA viva (${AI_BILLING}).`
      : "\n✅ Clasificación de chats: todo bien."
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
