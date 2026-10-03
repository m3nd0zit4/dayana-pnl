/**
 * Clasificación de chats de WhatsApp. Contra la base de DESARROLLO, sin enviar
 * nada; la parte dudosa llama de verdad al modelo Flash-Lite (centavos).
 *
 *   bun scripts/chat-category-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * 1. Reglas: cliente (pagó), interesada (autoevaluación), comunidad
 *    (masterclass + «gracias»), negocio (código), equipo (Ajustes), otro
 *    (nunca escribió). La libreta del celular NO decide «personal».
 * 2. Manual: gana siempre (volver a clasificar, mensajes nuevos).
 * 3. IA real para los dudosos (interés, agencia, libreta); apagada o chat en
 *    modo Manual → no se llama. Si Google la bloquea por facturación, esas
 *    comprobaciones salen SKIPPED; cualquier otro error falla.
 * 4. Mensajes nuevos, cambios en el CRM (reclassifyByRulesNow,
 *    refreshCrmCategories, markForReclassification) y escrituras viejas.
 * 5. «Clasificar todo», arriendo y contadores.
 * 6. Equipo: número sin código de país, clienta en el equipo, salir del equipo.
 * 7. Errores de la IA simulados: facturación, cuota, fallos seguidos, sin
 *    categoría (→ interesada · revisar).
 */
import { APICallError, NoObjectGeneratedError } from "ai";

import { prisma } from "@/lib/db";
import {
  BUSY_RETRY_AFTER_MS,
  CLASSIFY_ENABLED_KEY,
  TEAM_PHONES_KEY,
  acquireClassifyLock,
  categoryCounts,
  classifyConversation,
  classifyFromCron,
  classifyPending,
  markForReclassification,
  notSilencedWhere,
  pendingClassificationWhere,
  reclassifyByRulesNow,
  refreshCrmCategories,
  releaseClassifyLock,
  setManualCategory,
  setTeamPhones,
  type ClassifyOutcome,
} from "@/lib/crm/chat-category";
import { classifierModelId, type AiVerdict } from "@/lib/crm/chat-category-ai";
import { CHAT_CATEGORIES, isSilencingCategory } from "@/lib/crm/chat-category-rules";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};
/** Solo para lo que necesita la IA viva cuando Google la bloquea por facturación. */
const skipped: string[] = [];
/** La clasificación está encendida durante la prueba. */
const ON = { enabled: true };
const AI_BILLING = "IA bloqueada por facturación de Google";
const GENERAL_MANUAL = "modo general Manual (lo cambió otra prueba en la base compartida)";
let skipWhy = AI_BILLING;
const skip = (name: string) => {
  console.log(`  ⏭️  ${name} — SKIPPED: ${skipWhy}`);
  skipped.push(name);
};

const run = Date.now();
const T = {
  cliente: "573000009501",
  interesada: "573000009502",
  comunidad: "573000009503",
  libreta: "573000009504",
  negocio: "573000009505",
  equipo: "573000009506",
  otro: "573000009507",
  manual: "573000009508",
  aiInterest: "573000009509",
  aiVendor: "573000009510",
  modoManual: "573000009511",
  d1: "573000009512",
  d2: "573000009513",
  d3: "573000009514",
  d4: "573000009515",
  codigo: "573000009516",
} as const;
const THREADS = Object.values(T);
const DIAG_PREFIX = "e2e-clasif-";
const WEBINAR_SLUG = `e2e-clasif-${run}`;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

type Msg = { dir: "INBOUND" | "OUTBOUND"; body: string; source?: string; isEcho?: boolean };
const createChat = async (
  thread: string,
  name: string,
  msgs: Msg[],
  opts: { contactId?: string; aiMode?: "AUTO" | "COPILOT" | "MANUAL" } = {}
) => {
  const sent = msgs.map((m, i) => ({ ...m, at: minutesAgo(msgs.length - i) }));
  const lastInbound = sent.filter((m) => m.dir === "INBOUND").at(-1)?.at ?? null;
  const conv = await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: thread,
      metaAccountId: "test-phone-id",
      participantName: name,
      contactId: opts.contactId ?? null,
      aiMode: opts.aiMode ?? "AUTO",
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

/** Un modelo de mentira que cuenta las llamadas. */
const fakeAi = (behavior: () => never | AiVerdict) => {
  const counter = { calls: 0 };
  const classifier = async () => {
    counter.calls++;
    return behavior();
  };
  return { counter, classifier };
};
const throwing = (e: unknown) => () => {
  throw e;
};
const apiErr = (statusCode: number, message: string) =>
  new APICallError({ message, url: "https://generativelanguage.googleapis.com", requestBodyValues: {}, statusCode });

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({
    where: { externalThreadId: { in: THREADS } },
    select: { id: true },
  });
  const ids = convs.map((c) => c.id);
  await prisma.auditLog.deleteMany({ where: { entityType: "ConversationCategory", entityId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await prisma.diagnostic.deleteMany({ where: { token: { startsWith: DIAG_PREFIX } } });
  await prisma.contact.deleteMany({ where: { phoneE164: { in: THREADS.map((t) => `+${t}`) } } });
  await prisma.freeWebinar.deleteMany({ where: { slug: { startsWith: "e2e-clasif-" } } });
  await prisma.whatsAppKnownContact.deleteMany({ where: { phone: { in: THREADS } } });
};

const restoreSetting = async (key: string, prev: { value: string } | null) => {
  if (prev) {
    await prisma.siteSetting.upsert({ where: { key }, create: { key, value: prev.value }, update: { value: prev.value } });
  } else {
    await prisma.siteSetting.deleteMany({ where: { key } });
  }
};

const setEnabled = (on: boolean) =>
  prisma.siteSetting.upsert({
    where: { key: CLASSIFY_ENABLED_KEY },
    create: { key: CLASSIFY_ENABLED_KEY, value: String(on) },
    update: { value: String(on) },
  });

const main = async () => {
  await cleanup();
  const prevTeam = await prisma.siteSetting.findUnique({ where: { key: TEAM_PHONES_KEY } });
  const prevEnabled = await prisma.siteSetting.findUnique({ where: { key: CLASSIFY_ENABLED_KEY } });
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER" }, select: { id: true } });
  const aiStats: { model?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null }[] = [];
  let aiBlocked = false;

  try {
    await setEnabled(true);

    // ── Datos del CRM ──────────────────────────────────────────────────
    const product = await prisma.product.findFirstOrThrow({ where: { kind: "THERAPY" }, select: { id: true } });
    const contact = (thread: string, firstName: string) =>
      prisma.contact.create({ data: { phoneE164: `+${thread}`, firstName, source: "WHATSAPP_DIRECT" }, select: { id: true } });

    const cCliente = await contact(T.cliente, "Clienta E2E");
    await prisma.enrollment.create({
      data: { contactId: cCliente.id, productId: product.id, status: "ACTIVE", amountMinor: 50_000, currency: "USD" },
    });
    const cInteresada = await contact(T.interesada, "Interesada E2E");
    await prisma.diagnostic.create({ data: { token: `${DIAG_PREFIX}${run}-a`, contactId: cInteresada.id, completedAt: new Date() } });
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
    await prisma.whatsAppKnownContact.create({ data: { phone: T.libreta, name: "Tía E2E" } });
    const team = await setTeamPhones([...(prevTeam ? (JSON.parse(prevTeam.value) as string[]) : []), `+${T.equipo}`], staff.id);
    check("guarda el número del equipo", team.ok);

    // ── Chats ──────────────────────────────────────────────────────────
    const ids = {
      cliente: await createChat(
        T.cliente,
        "Clienta",
        [
          { dir: "INBOUND", body: "Hola Dayana, ¿me confirmas la sesión del jueves?" },
          { dir: "OUTBOUND", body: "Sí, el jueves a las 5 💛" },
        ],
        { contactId: cCliente.id }
      ),
      interesada: await createChat(
        T.interesada,
        "Interesada",
        [{ dir: "OUTBOUND", body: "Hola, te bendigo 💛 Leí tu autoevaluación…", source: "autoevaluacion" }],
        { contactId: cInteresada.id }
      ),
      comunidad: await createChat(
        T.comunidad,
        "Comunidad",
        [
          { dir: "OUTBOUND", body: "Hoy es la masterclass a las 7 pm 💛", source: "bulk:e2e" },
          { dir: "INBOUND", body: "Muchas gracias Dayana 🙏 ahí estaré" },
          { dir: "INBOUND", body: "Bendiciones, me encantó la clase ❤️" },
        ],
        { contactId: cComunidad.id }
      ),
      libreta: await createChat(T.libreta, "Tía", [
        { dir: "INBOUND", body: "Mija, ¿vienes el domingo al almuerzo? Tu tío hace sancocho" },
        { dir: "OUTBOUND", body: "Sí tía, allá llego", isEcho: true },
      ]),
      negocio: await createChat(T.negocio, "Verificación", [
        { dir: "INBOUND", body: "Tu código de verificación es 482913. No lo compartas con nadie." },
      ]),
      equipo: await createChat(T.equipo, "Asistente", [{ dir: "INBOUND", body: "Ya subí el video editado al drive" }]),
      otro: await createChat(T.otro, "Invitada", [{ dir: "OUTBOUND", body: "Hola, ¿cómo vas?", isEcho: true }]),
      manual: await createChat(T.manual, "Manual", [{ dir: "INBOUND", body: "Tu código de seguridad es 771204" }]),
      aiInterest: await createChat(T.aiInterest, "Lucía", [
        { dir: "INBOUND", body: "Hola! Vi tu video sobre la ansiedad en TikTok. ¿Cómo funcionan tus sesiones y cuánto cuestan?" },
      ]),
      aiVendor: await createChat(T.aiVendor, "Carolina", [
        {
          dir: "INBOUND",
          body: "Hola Dayana, soy Carolina de una agencia de marketing digital. Ayudamos a coaches a conseguir más pacientes con anuncios en Instagram. ¿Te puedo enviar una propuesta?",
        },
      ]),
      modoManual: await createChat(
        T.modoManual,
        "Modo manual",
        [{ dir: "INBOUND", body: "Hola, ¿cómo funcionan las sesiones?" }],
        { aiMode: "MANUAL" }
      ),
    };
    const own = Object.values(ids);

    console.log("\n1. Reglas");
    const expected: [keyof typeof ids, string, string][] = [
      ["cliente", "cliente", "Pagó un paquete"],
      ["interesada", "interesada", "Hizo la autoevaluación"],
      ["comunidad", "comunidad", "Se inscribió a un evento y solo agradece o saluda"],
      ["negocio", "negocio", "Código de verificación"],
      ["equipo", "equipo", "Número del equipo"],
      ["otro", "otro", "Nunca escribió: solo le escribimos nosotros"],
    ];
    for (const [key, category, reason] of expected) {
      const out = await classifyConversation(ids[key], { useAi: false });
      const s = await state(ids[key]);
      check(
        `${key} → ${category} por regla («${reason}»)`,
        out.status === "classified" && s.category === category && s.categorySource === "rule" && s.categoryReason === reason,
        { out, s }
      );
    }
    const equipoState = await state(ids.equipo);
    check("la regla del equipo no pide «revisar» y silencia", !equipoState.categoryReview && isSilencingCategory(equipoState, ON));
    check("el código por regla silencia", isSilencingCategory(await state(ids.negocio), ON));
    check("cubre hasta el último mensaje", equipoState.categorizedThroughAt?.getTime() === equipoState.lastMessageAt.getTime());
    const libretaRules = await classifyConversation(ids.libreta, { useAi: false });
    check(
      "la libreta del celular sola NO decide «personal» (espera a la IA)",
      libretaRules.status === "skipped" && libretaRules.reason === "needs_ai" && (await state(ids.libreta)).category === null,
      libretaRules
    );

    console.log("\n2. Manual: gana siempre");
    await setManualCategory(ids.manual, "personal", staff.id);
    let m = await state(ids.manual);
    check("se guardó como manual (y silencia)", m.category === "personal" && m.categorySource === "manual" && isSilencingCategory(m, ON), m);
    const audit = await prisma.auditLog.count({ where: { entityType: "ConversationCategory", entityId: ids.manual } });
    check("queda en el registro de auditoría", audit === 1, audit);
    const forced = await classifyConversation(ids.manual, { force: true });
    m = await state(ids.manual);
    check("«volver a clasificar» no lo pisa", forced.status === "skipped" && m.categorySource === "manual", { forced, m });
    await addMessage(ids.manual, { dir: "INBOUND", body: "Tu código de seguridad es 990011" });
    const pendingIds = (await prisma.conversation.findMany({ where: pendingClassificationWhere(), select: { id: true } })).map((c) => c.id);
    check("con un mensaje nuevo no entra en la cola de pendientes", !pendingIds.includes(ids.manual));
    const otherChannel = await prisma.conversation.create({
      data: { channel: "INSTAGRAM", externalThreadId: T.d4, metaAccountId: "test-ig", participantName: "IG" },
      select: { id: true },
    });
    check("un chat que no es de WhatsApp no se marca", (await setManualCategory(otherChannel.id, "negocio", staff.id)) === null);
    await prisma.conversation.delete({ where: { id: otherChannel.id } });

    console.log("\n3. Apagada, modo Manual e IA real");
    {
      const probe = fakeAi(throwing(new Error("no debería llamarse")));
      await setEnabled(false);
      const off = await classifyConversation(ids.aiInterest, { classifier: probe.classifier });
      await setEnabled(true);
      check("con la clasificación apagada no va a la IA", off.status === "skipped" && off.reason === "needs_ai" && probe.counter.calls === 0, off);
      const manualMode = await classifyConversation(ids.modoManual, { classifier: probe.classifier });
      check(
        "un chat en modo Manual nunca va a la IA",
        manualMode.status === "skipped" && manualMode.reason === "needs_ai" && probe.counter.calls === 0,
        manualMode
      );
    }
    console.log(`     modelo: ${classifierModelId()}`);
    // Con el modo general en Manual ningún chat va a la IA (es lo correcto):
    // pasa si otra prueba de la base compartida lo cambió justo ahora.
    const generalManual = (await getWhatsAppAiConfig()).defaultMode === "MANUAL";
    const aiOutcomes: Record<string, ClassifyOutcome> = {};
    for (const key of ["aiInterest", "aiVendor", "libreta"] as const) {
      const out = await classifyConversation(ids[key]);
      aiOutcomes[key] = out;
      if (out.status === "classified") aiStats.push(out);
      console.log(`     ${key}: ${JSON.stringify(out)}`);
    }
    // Solo el 403 de facturación de Google (o el modo general en Manual) se
    // salta; cualquier otro error falla.
    aiBlocked = Object.values(aiOutcomes).some((o) => o.status === "error" && o.kind === "billing");
    if (generalManual) {
      skipWhy = GENERAL_MANUAL;
      aiBlocked = true;
      check(
        "con el modo general en Manual no va a la IA",
        Object.values(aiOutcomes).every((o) => o.status === "skipped" && o.reason === "needs_ai"),
        aiOutcomes
      );
      for (const name of ["interés → interesada", "agencia → negocio", "libreta → IA", "guarda confianza y «revisar»"]) skip(name);
    } else if (aiBlocked) {
      for (const name of ["interés → interesada", "agencia → negocio", "libreta → IA", "guarda confianza y «revisar»"]) skip(name);
      for (const key of ["aiInterest", "aiVendor", "libreta"] as const) {
        const o = aiOutcomes[key];
        check(`${key}: el error es exactamente el 403 de facturación`, o.status === "error" && o.kind === "billing", o);
        const s = await state(ids[key]);
        check(`${key}: con la IA bloqueada el chat queda sin tocar`, s.category === null && s.categorizedThroughAt === null, s);
      }
    } else {
      const [a1, a2, a3] = [aiOutcomes.aiInterest, aiOutcomes.aiVendor, aiOutcomes.libreta];
      check("pregunta por sesiones y precio → interesada (IA)", a1.status === "classified" && a1.source === "ai" && a1.category === "interesada", a1);
      check(
        "agencia ofreciendo anuncios → negocio u otro (IA)",
        a2.status === "classified" && a2.source === "ai" && (a2.category === "negocio" || a2.category === "otro"),
        a2
      );
      check("la libreta la decide la IA, nunca «equipo»", a3.status === "classified" && a3.source === "ai" && a3.category !== "equipo", a3);
      for (const key of ["aiInterest", "aiVendor", "libreta"] as const) {
        const s = await state(ids[key]);
        const silent = s.category === "personal" || s.category === "negocio";
        check(
          `${key}: confianza, motivo corto y «revisar» según la categoría`,
          s.categorySource === "ai" &&
            typeof s.categoryConfidence === "number" &&
            (s.categoryReason?.length ?? 0) > 0 &&
            (s.categoryReason?.length ?? 0) <= 120 &&
            s.categoryReview === (s.categoryConfidence ?? 0) < (silent ? 0.9 : 0.7),
          s
        );
        check(
          `${key}: silencia solo si es personal/negocio con ≥ 0,9`,
          isSilencingCategory(s, ON) === (silent && (s.categoryConfidence ?? 0) >= 0.9),
          s
        );
      }
    }

    console.log("\n4. Mensajes nuevos, cambios en el CRM y escrituras viejas");
    await addMessage(ids.aiInterest, { dir: "OUTBOUND", body: "¡Hola Lucía! Te cuento…" });
    if (aiBlocked) {
      skip("un mensaje nuestro no vuelve a llamar a la IA (se conserva)");
    } else {
      const probe = fakeAi(throwing(new Error("no debería llamarse")));
      const keptOut = await classifyConversation(ids.aiInterest, { classifier: probe.classifier });
      check(
        "un mensaje nuestro no vuelve a llamar a la IA (se conserva)",
        keptOut.status === "classified" && keptOut.kept === true && probe.counter.calls === 0,
        keptOut
      );
    }
    await addMessage(ids.otro, { dir: "INBOUND", body: "Tu código de acceso es 55821" });
    const again = await classifyConversation(ids.otro, { useAi: false });
    check("«otro» que escribe un código → negocio", again.status === "classified" && again.category === "negocio", again);
    const upToDate = await classifyConversation(ids.otro);
    check("sin nada nuevo no se vuelve a mirar", upToDate.status === "skipped" && upToDate.reason === "up_to_date", upToDate);

    // La IA lo había dejado en «negocio» y después hizo la autoevaluación.
    await prisma.conversation.update({
      where: { id: ids.aiVendor },
      data: { category: "negocio", categorySource: "ai", categoryConfidence: 0.95, categoryReview: false, categoryReason: "Agencia" },
    });
    check("antes del cambio, silenciaría", isSilencingCategory(await state(ids.aiVendor), ON));
    const cVendor = await contact(T.aiVendor, "Carolina E2E");
    await prisma.conversation.update({ where: { id: ids.aiVendor }, data: { contactId: cVendor.id } });
    await prisma.diagnostic.create({ data: { token: `${DIAG_PREFIX}${run}-b`, contactId: cVendor.id, completedAt: new Date() } });
    const now = await reclassifyByRulesNow(ids.aiVendor);
    check(
      "reclassifyByRulesNow: hizo la autoevaluación → interesada, ya no silencia",
      now?.category === "interesada" && now.categorySource === "rule" && now.silencing === false,
      now
    );
    const manualNow = await reclassifyByRulesNow(ids.manual);
    check("reclassifyByRulesNow respeta lo manual", manualNow?.categorySource === "manual" && manualNow.silencing === true, manualNow);

    // N9: con la clasificación apagada nada silencia; la etiqueta se queda.
    await setEnabled(false);
    const offNow = await reclassifyByRulesNow(ids.manual);
    await setEnabled(true);
    check(
      "apagada: ni lo manual silencia (la etiqueta se queda)",
      offNow?.category === "personal" && offNow.categorySource === "manual" && offNow.silencing === false,
      offNow
    );

    // N2: una regla que ya no aplica (era un código; ahora escribe de verdad).
    await addMessage(ids.negocio, { dir: "INBOUND", body: "Hola Dayana, quiero información de la terapia" });
    const ruleStale = await reclassifyByRulesNow(ids.negocio);
    const negocioAfter = await state(ids.negocio);
    check(
      "regla vieja que ya no aplica: se borra, queda pendiente y no silencia",
      ruleStale?.category === null && ruleStale.silencing === false && negocioAfter.categorizedThroughAt === null,
      { ruleStale, negocioAfter }
    );

    // N2: la IA dijo «personal», pero la persona escribió después.
    const libretaNow = await state(ids.libreta);
    await prisma.conversation.update({
      where: { id: ids.libreta },
      data: {
        category: "personal",
        categorySource: "ai",
        categoryConfidence: 0.95,
        categoryReview: false,
        categoryReason: "Familiar",
        categorizedThroughAt: libretaNow.lastMessageAt,
      },
    });
    const aiFresh = await reclassifyByRulesNow(ids.libreta);
    check("IA segura y sin mensajes nuevos: silencia", aiFresh?.silencing === true && aiFresh.stale === false, aiFresh);
    await addMessage(ids.libreta, { dir: "INBOUND", body: "Oye, ¿y cuánto cuesta una sesión contigo?" });
    const aiStale = await reclassifyByRulesNow(ids.libreta);
    check(
      "IA vieja (escribió después): no silencia hasta que la IA lo vuelva a mirar",
      aiStale?.category === "personal" && aiStale.stale === true && aiStale.silencing === false,
      aiStale
    );

    // Pagó: el reloj lo recoge aunque no haya mensajes nuevos.
    await prisma.enrollment.create({
      data: { contactId: cVendor.id, productId: product.id, status: "ACTIVE", amountMinor: 80_000, currency: "USD" },
    });
    const refreshed = await refreshCrmCategories({ ids: own });
    const vendorAfter = await state(ids.aiVendor);
    check("refreshCrmCategories: pagó → cliente", refreshed.updated >= 1 && vendorAfter.category === "cliente", { refreshed, vendorAfter });
    const refreshedAgain = await refreshCrmCategories({ ids: own });
    check("refreshCrmCategories no reescribe lo que ya está bien", refreshedAgain.updated === 0, refreshedAgain);
    check("refreshCrmCategories no toca lo manual", (await state(ids.manual)).categorySource === "manual");

    const marked = await markForReclassification({ contactId: cVendor.id });
    check("markForReclassification deja el chat pendiente", marked === 1 && (await state(ids.aiVendor)).categorizedThroughAt === null, marked);
    check("markForReclassification no toca lo manual", (await markForReclassification({ conversationId: ids.manual })) === 0);
    await classifyConversation(ids.aiVendor, { useAi: false });

    // Otra tanda ya guardó algo que cubre un mensaje posterior: no se pisa.
    const future = new Date(Date.now() + 3_600_000);
    await prisma.conversation.update({ where: { id: ids.comunidad }, data: { categorizedThroughAt: future, category: "otro" } });
    const staleOut = await classifyConversation(ids.comunidad, { force: true, useAi: false });
    const staleState = await state(ids.comunidad);
    check("no pisa una clasificación más nueva", staleOut.status === "skipped" && staleOut.reason === "stale" && staleState.category === "otro", {
      staleOut,
      staleState,
    });
    await prisma.conversation.update({ where: { id: ids.comunidad }, data: { categorizedThroughAt: null, category: null } });

    console.log("\n5. «Clasificar todo», arriendo y contadores");
    // Nunca se llama a una tanda sin `ids` si no tenemos el arriendo: correría
    // sobre toda la base compartida. Si no se puede tomar, la prueba falla.
    const lock = await acquireClassifyLock();
    check("se toma el arriendo", Boolean(lock));
    if (lock) {
      try {
        const busy = await classifyPending({ useAi: false });
        check(
          "con el arriendo tomado, otra tanda no hace nada y dice cuándo reintentar",
          busy.busy && busy.processed === 0 && busy.retryAfterMs === BUSY_RETRY_AFTER_MS,
          busy
        );
        const cronBusy = await classifyFromCron(30_000);
        check("el reloj tampoco (todo bajo el mismo arriendo)", "skipped" in cronBusy && cronBusy.skipped === "busy", cronBusy);
        check("el arriendo no se da dos veces", (await acquireClassifyLock()) === null);
      } finally {
        await releaseClassifyLock(lock);
      }
    }

    let rounds = 0;
    let progress = await classifyPending({ limit: 40, budgetMs: 45_000, ids: own });
    rounds++;
    while (progress.remaining > 0 && progress.classified > 0 && !progress.aiBlocked && rounds < 5) {
      progress = await classifyPending({ limit: 40, budgetMs: 45_000, ids: own });
      rounds++;
    }
    check("«clasificar todo» no falla", progress.failed === 0, progress);
    const ownPending = await prisma.conversation.findMany({
      where: { id: { in: own }, ...pendingClassificationWhere() },
      select: { id: true },
    });
    // Queda el chat en modo Manual (nunca va a la IA) y, si Google bloquea la IA, los dudosos.
    const allowedPending = new Set([ids.modoManual, ...(aiBlocked ? [ids.aiInterest, ids.aiVendor, ids.libreta, ids.negocio] : [])]);
    check("solo quedan pendientes los que esperan a la IA", ownPending.every((p) => allowedPending.has(p.id)), {
      ownPending,
      progress,
    });
    check("comunidad vuelve a comunidad", (await state(ids.comunidad)).category === "comunidad");
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
    check("cuenta las manuales y dice que está encendida", counts.manual >= 1 && counts.enabled, counts);

    // Para las colas de B2: el mismo criterio que isSilencingCategory, en SQL.
    const ownStates = await prisma.conversation.findMany({
      where: { id: { in: own } },
      select: { id: true, category: true, categorySource: true, categoryConfidence: true, categoryReview: true },
    });
    const notSilenced = new Set(
      (await prisma.conversation.findMany({ where: { id: { in: own }, ...notSilencedWhere(true) }, select: { id: true } })).map(
        (r) => r.id
      )
    );
    const mismatches = ownStates.filter((st) => notSilenced.has(st.id) === isSilencingCategory(st, ON));
    check(
      "notSilencedWhere = !isSilencingCategory (sin perder los sin clasificar)",
      mismatches.length === 0 && ownStates.some((st) => st.category === null) && ownStates.some((st) => isSilencingCategory(st, ON)),
      { mismatches, ownStates }
    );
    check("notSilencedWhere apagada no excluye nada", Object.keys(notSilencedWhere(false)).length === 0);

    console.log("\n6. Equipo");
    const bad = await setTeamPhones(["300 123 4567", "12345678", "55 1234 5678"], staff.id);
    check("rechaza los números sin código de país y dice cuáles", !bad.ok && bad.invalid.join("|") === "12345678|55 1234 5678", bad);
    const withClient = await setTeamPhones([`+${T.equipo}`, `+${T.cliente}`], staff.id);
    check(
      "avisa si un número del equipo es de una clienta",
      withClient.ok && withClient.warnings.some((w) => w.phone === `+${T.cliente}`),
      withClient
    );
    const restored = prevTeam ? (JSON.parse(prevTeam.value) as string[]) : [];
    const res = await setTeamPhones(restored, staff.id);
    const eq = await state(ids.equipo);
    check(
      "sale del equipo: se vuelve a mirar solo con reglas y queda sin clasificar",
      res.ok && res.reclassified.some((o) => o.id === ids.equipo) && eq.category === null,
      { res, eq }
    );
    check("la clienta que salió del equipo vuelve a «cliente»", (await state(ids.cliente)).category === "cliente");

    console.log("\n7. Errores de la IA (simulados)");
    if ((await getWhatsAppAiConfig()).defaultMode === "MANUAL") {
      skipWhy = GENERAL_MANUAL;
      skip("errores de la IA simulados");
    } else {
      const d = {
        d1: await createChat(T.d1, "Dudosa 1", [{ dir: "INBOUND", body: "Hola, ¿me puedes contar algo?" }]),
        d2: await createChat(T.d2, "Dudosa 2", [{ dir: "INBOUND", body: "Buenas, una consulta" }]),
        d3: await createChat(T.d3, "Dudosa 3", [{ dir: "INBOUND", body: "Hola" }]),
        d4: await createChat(T.d4, "Dudosa 4", [{ dir: "INBOUND", body: "Buenas noches" }]),
        codigo: await createChat(T.codigo, "Código", [{ dir: "INBOUND", body: "Tu código de verificación es 330145" }]),
      };
      const dIds = Object.values(d);
      const dudosas = [d.d1, d.d2, d.d3, d.d4];
      const untouched = async () => (await Promise.all(dudosas.map(state))).every((s) => s.category === null && s.categorizedThroughAt === null);

      const billing = fakeAi(throwing(apiErr(403, "Lightning dunning decision is deny for project: projects/000000000000")));
      const rb = await classifyPending({ ids: dIds, concurrency: 1, budgetMs: 30_000, classifier: billing.classifier });
      check("facturación: la tanda lo dice y deja de llamar tras el primer 403", rb.aiBlocked === "billing" && billing.counter.calls === 1, {
        rb,
        calls: billing.counter.calls,
      });
      check("facturación: no es un fallo; los dudosos esperan", rb.failed === 0 && rb.needsAi === 4 && (await untouched()), rb);
      check("facturación: las reglas siguen (el código queda como negocio)", (await state(d.codigo)).category === "negocio");
      check("facturación: los dudosos siguen en la cola", rb.remaining === 4, rb.remaining);

      const rate = fakeAi(throwing(apiErr(429, "Resource has been exhausted")));
      const rr = await classifyPending({ ids: dIds, concurrency: 1, budgetMs: 30_000, classifier: rate.classifier });
      check(
        "cuota (429): corta la IA en esa vuelta, cuenta un fallo",
        rr.aiBlocked === "rate" && rate.counter.calls === 1 && rr.failed === 1 && rr.needsAi === 3 && (await untouched()),
        { rr, calls: rate.counter.calls }
      );

      const flaky = fakeAi(throwing(apiErr(503, "The model is overloaded")));
      const rf = await classifyPending({ ids: dIds, concurrency: 1, budgetMs: 30_000, classifier: flaky.classifier });
      check(
        "3 fallos seguidos (503): corta la IA",
        rf.aiBlocked === "errors" && flaky.counter.calls === 3 && rf.failed === 3 && rf.needsAi === 1 && (await untouched()),
        { rf, calls: flaky.counter.calls }
      );

      const noObject = fakeAi(
        throwing(
          new NoObjectGeneratedError({
            message: "No object generated: content filter",
            response: { id: "x", timestamp: new Date(), modelId: "fake" },
            usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } as never,
            finishReason: "content-filter" as never,
          })
        )
      );
      const rn = await classifyPending({ ids: dIds, concurrency: 1, budgetMs: 30_000, classifier: noObject.classifier });
      const dStates = await Promise.all(dudosas.map(state));
      check(
        "sin categoría (bloqueo de seguridad): «interesada · revisar», nunca callado",
        rn.byAi === 4 &&
          rn.review === 4 &&
          dStates.every((s) => s.category === "interesada" && s.categoryReview && s.categorySource === "ai" && !isSilencingCategory(s, ON)),
        { rn, dStates }
      );
    }
  } finally {
    await cleanup();
    await restoreSetting(TEAM_PHONES_KEY, prevTeam);
    await restoreSetting(CLASSIFY_ENABLED_KEY, prevEnabled);
    await prisma.auditLog.deleteMany({
      where: { entityType: "SiteSetting", entityId: { in: [TEAM_PHONES_KEY, CLASSIFY_ENABLED_KEY] }, createdAt: { gte: new Date(run) } },
    });
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

  if (skipped.length) console.log(`\n⏭️  ${skipped.length} comprobación(es) SKIPPED: ${skipWhy}.`);
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallo(s):\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log(
    skipped.length
      ? `\n✅ Clasificación de chats: todo bien, salvo lo SKIPPED (${skipWhy}).`
      : "\n✅ Clasificación de chats: todo bien."
  );
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
