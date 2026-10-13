/**
 * «Empezar limpio» y de qué aprende la IA, contra la base de DESARROLLO.
 * Sin modelo: los ejemplos se guardan aunque falte calcular su vector.
 *
 *   bun scripts/whatsapp-ai-reset-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Aprender de un chat: solo lo que Dayana escribió contestando (ni la IA,
 *    ni su borrador aprobado, ni el masivo, ni el aviso gris); de un chat
 *    personal, nada.
 * 2. La limpieza: borra las propuestas, apaga los básicos repetidos (y quita
 *    su referencia), quita los ejemplos que no son de Dayana y las plantillas,
 *    la memoria de la IA y el Copiloto pegado. Deja lo de Dayana.
 * 3. Deshacer: todo vuelve como estaba.
 *
 * La limpieza es de toda la base: lo que ya había en desarrollo se deshace al
 * final con la misma copia.
 */
export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";
// Sin vectores: el ejemplo se guarda y su vector queda pendiente.
delete process.env.GEMINI_API_KEY;

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { learnFromConversation } = await import("@/lib/crm/whatsapp-learning");
  const { applyAiReset, planAiReset, undoAiReset, lastAiResetBackup } = await import("@/lib/crm/whatsapp-agent/ai-reset");
  const { setManualCategory } = await import("@/lib/crm/chat-category");
  const { DEFAULT_PLAYBOOKS } = await import("@/lib/crm/whatsapp-agent/playbooks");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const WORK = "573000007711";
  const FAMILY = "573000007712";
  const NOTED = "573000007713";
  const CHOSEN = "573000007714";
  const TEMPLATE = ["573000007721", "573000007722", "573000007723", "573000007724", "573000007725"];
  const THREADS = [WORK, FAMILY, NOTED, CHOSEN, ...TEMPLATE];
  const PB = "e2e-reset ";

  const cleanup = async () => {
    const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
    const ids = convs.map((c) => c.id);
    const pbIds = (
      await prisma.whatsAppPlaybook.findMany({ where: { OR: [{ name: { startsWith: PB } }, { trigger: { startsWith: PB } }] }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...pbIds] } } });
    await prisma.whatsAppReplyExample.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { sourceKey: { startsWith: "e2e-reset:" } }] } });
    await prisma.whatsAppMemory.deleteMany({ where: { phone: { in: THREADS } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.whatsAppPlaybook.deleteMany({ where: { OR: [{ name: { startsWith: PB } }, { trigger: { startsWith: PB } }] } });
  };
  await cleanup();

  let n = 0;
  type Line = { dir: "INBOUND" | "OUTBOUND"; body: string; source?: string; isAutoReply?: boolean; kind?: string; isEcho?: boolean };
  const chat = async (thread: string, lines: Line[], aiMode: "AUTO" | "COPILOT" = "AUTO") => {
    const conv = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: thread, metaAccountId: "e2e", participantName: "Lucía", lastMessageAt: new Date(), aiMode },
    });
    const ids: string[] = [];
    for (const [i, l] of lines.entries()) {
      const m = await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          direction: l.dir,
          status: "DELIVERED",
          externalMessageId: `wamid.e2e.reset.${thread}.${n++}`,
          body: l.body,
          source: l.source ?? null,
          isAutoReply: l.isAutoReply ?? false,
          isEcho: l.isEcho ?? false,
          kind: l.kind ?? "message",
          sentAt: new Date(Date.now() - (lines.length - i) * 600_000),
        },
      });
      ids.push(m.id);
    }
    return { conv, ids };
  };
  const examplesOf = (conversationId: string) =>
    prisma.whatsAppReplyExample.findMany({ where: { conversationId }, select: { replyText: true, sourceKey: true } });

  // Lo que había en desarrollo antes (la limpieza es global; se deshace al final).
  // Por ids, no por conteo: otras pruebas pueden estar creando chats a la vez.
  const before = {
    memories: (await prisma.whatsAppMemory.findMany({ select: { phone: true } })).map((m) => m.phone),
    sticky: (
      await prisma.conversation.findMany({ where: { channel: "WHATSAPP", aiMode: "COPILOT", aiModeOverride: null }, select: { id: true } })
    ).map((c) => c.id),
  };
  /** Limpiezas sin deshacer (si algo falla, se deshacen al final). */
  let applied = 0;

  try {
    console.log("\n1. De qué aprende");
    const work = await chat(
      WORK,
      [
        { dir: "INBOUND", body: "Hola, quiero información de las terapias" },
        { dir: "OUTBOUND", body: "Hola Lucía, te bendigo. Cuéntame, ¿cómo estás?", isEcho: true },
        { dir: "INBOUND", body: "Muy triste últimamente" },
        { dir: "OUTBOUND", body: "Te entiendo, ¿cuánto tiempo más quieres seguir así?", source: "approval" },
        { dir: "INBOUND", body: "No sé, ya no quiero" },
        { dir: "OUTBOUND", body: "Mañana es la masterclass gratuita, te espero", source: "bulk:e2e" },
        { dir: "INBOUND", body: "¿Me llamas?" },
        { dir: "OUTBOUND", body: "Llamada perdida", kind: "system" },
        { dir: "INBOUND", body: "Gracias" },
        { dir: "OUTBOUND", body: "Con gusto, te bendigo", isAutoReply: true },
      ],
      "COPILOT"
    );
    await learnFromConversation(work.conv.id);
    const learned = await examplesOf(work.conv.id);
    check(
      "solo aprende lo que Dayana escribió contestando",
      learned.length === 1 && learned[0].replyText.startsWith("Hola Lucía, te bendigo"),
      learned.map((e) => e.replyText)
    );

    const family = await chat(FAMILY, [
      { dir: "INBOUND", body: "Hija, ¿vienes a almorzar?" },
      { dir: "OUTBOUND", body: "Sí mami, llego a la 1", isEcho: true },
    ]);
    await setManualCategory(family.conv.id, "personal", null);
    await learnFromConversation(family.conv.id);
    check("de un chat personal no aprende nada", (await examplesOf(family.conv.id)).length === 0);

    console.log("\n2. Empezar limpio");
    // Lo que dejó el aprendizaje de antes (como en producción).
    const [, , , approvalId, , bulkId, , systemId] = work.ids;
    const quick = "Hola, gracias por escribir. Las terapias son virtuales, una hora por Meet, y Dayana te cuenta todo en la llamada.";
    const old = [
      { sourceKey: `inbox:${approvalId}`, conversationId: work.conv.id, replyText: "Te entiendo, ¿cuánto tiempo más quieres seguir así?" },
      { sourceKey: `inbox:${bulkId}`, conversationId: work.conv.id, replyText: "Mañana es la masterclass gratuita, te espero" },
      { sourceKey: `inbox:${systemId}`, conversationId: work.conv.id, replyText: "Llamada perdida" },
      { sourceKey: "inbox:e2e-reset-borrado", conversationId: work.conv.id, replyText: "Un mensaje que ya no existe" },
      { sourceKey: `inbox:${family.ids[1]}`, conversationId: family.conv.id, replyText: "Sí mami, llego a la 1" },
    ];
    for (const e of old) {
      await prisma.whatsAppReplyExample.create({
        data: { ...e, source: "inbox", clientText: "Hola", repliedAt: new Date() },
      });
    }
    // La respuesta rápida de la app, pegada igual en 5 chats.
    for (const thread of TEMPLATE) {
      const t = await chat(thread, [
        { dir: "INBOUND", body: "Hola, info" },
        { dir: "OUTBOUND", body: quick, isEcho: true },
      ]);
      await learnFromConversation(t.conv.id);
    }
    check("la plantilla sí se guardó (se aprende de todo el chat)", (await prisma.whatsAppReplyExample.count({ where: { replyText: quick } })) === 5);

    // Procedimientos: dos propuestas, una que Dayana aprobó y después apagó, los
    // básicos con su texto original, uno básico que Dayana editó y uno suyo que
    // manda a «Agendar».
    const basic = (name: string) => DEFAULT_PLAYBOOKS.find((p) => p.name === name)!;
    await prisma.whatsAppPlaybook.createMany({
      data: [
        { name: `${PB}Cierre (propuesta)`, trigger: `${PB}agradece`, steps: "Con gusto", source: "learned", isEnabled: false },
        { name: `${PB}Agendar (propuesta) (propuesta)`, trigger: `${PB}agendar`, steps: "Pide la hora", source: "learned", isEnabled: false },
        { ...basic("Agendar"), trigger: `${PB}${basic("Agendar").trigger}`, source: "manual", isEnabled: true },
        { ...basic("Primer contacto"), trigger: `${PB}${basic("Primer contacto").trigger}`, source: "manual", isEnabled: true },
        { name: "Chat con conversación previa", trigger: `${PB}ya habló`, steps: "Mi forma: pregúntale cómo le fue.", source: "manual", isEnabled: true },
        {
          name: `${PB}Precios`,
          trigger: `${PB}precio`,
          steps: "Nunca des valores; ofrécele la llamada gratis (sigue «Agendar»).",
          source: "manual",
          isEnabled: true,
        },
      ],
    });
    const approvedOff = await prisma.whatsAppPlaybook.create({
      data: { name: `${PB}Talleres (propuesta)`, trigger: `${PB}talleres`, steps: "Cuéntale cuál hay", source: "learned", isEnabled: false },
    });
    await prisma.auditLog.create({ data: { action: "UPDATE", entityType: "WhatsAppPlaybook", entityId: approvedOff.id, changes: { isEnabled: true } } });

    // Memoria: una de la IA y una que escribió Dayana. Un chat en Copiloto porque Dayana lo eligió.
    await prisma.whatsAppMemory.create({ data: { phone: WORK, notes: "Primera vez que escribe (según la IA)." } });
    const noted = await chat(NOTED, [{ dir: "INBOUND", body: "Hola" }]);
    await prisma.whatsAppMemory.create({ data: { phone: NOTED, notes: "Es mi prima, no le vendas nada." } });
    await prisma.auditLog.create({ data: { action: "UPDATE", entityType: "WhatsAppChat", entityId: noted.conv.id, changes: { memory: 31 } } });
    const chosen = await chat(CHOSEN, [{ dir: "INBOUND", body: "Hola" }], "COPILOT");
    await prisma.auditLog.create({ data: { action: "UPDATE", entityType: "WhatsAppChat", entityId: chosen.conv.id, changes: { aiMode: "COPILOT" } } });

    const plan = await planAiReset();
    const ours = plan.proposals.filter((p) => p.name.startsWith(PB));
    check("propone borrar las 2 propuestas sin aprobar (no la que aprobó)", ours.length === 2 && !ours.some((p) => p.id === approvedOff.id), ours);
    check("propone apagar «Agendar» y «Primer contacto»", ["Agendar", "Primer contacto"].every((n) => plan.superseded.some((p) => p.name === n)), plan.superseded);
    check("el básico que Dayana editó se queda", !plan.superseded.some((p) => p.name === "Chat con conversación previa"), plan.superseded);
    check("propone quitar la referencia a «Agendar»", plan.textFixes.some((p) => p.name === `${PB}Precios`), plan.textFixes);
    const r = plan.examples.byReason;
    check(
      "encuentra cada ejemplo que no es de Dayana, con su motivo",
      (r.ai_draft ?? 0) >= 1 &&
        (r.auto_send ?? 0) >= 1 &&
        (r.system ?? 0) >= 1 &&
        (r.missing_message ?? 0) >= 1 &&
        (r.not_work_chat ?? 0) >= 1 &&
        (r.template ?? 0) >= 5,
      r
    );
    check("cuenta la memoria de la IA y el Copiloto pegado", plan.memories >= 1 && plan.stickyModes >= 1, { memories: plan.memories, sticky: plan.stickyModes });
    check("y separa las notas y el modo que eligió Dayana", plan.kept.staffMemories >= 1 && plan.kept.staffModes >= 1, plan.kept);

    const result = await applyAiReset({ memories: true, staffId: null });
    applied = 1;
    check("hay copia antes de cambiar nada", (await lastAiResetBackup())?.at === result.backupAt, result.backupAt);
    const left = await prisma.whatsAppReplyExample.findMany({ where: { conversationId: work.conv.id }, select: { replyText: true } });
    check("de ese chat queda solo la respuesta de Dayana", left.length === 1 && left[0].replyText.startsWith("Hola Lucía"), left);
    check("las plantillas se fueron", (await prisma.whatsAppReplyExample.count({ where: { replyText: quick } })) === 0);
    check("el ejemplo del chat personal se fue", (await examplesOf(family.conv.id)).length === 0);
    const ourPlaybooks = () =>
      prisma.whatsAppPlaybook.findMany({
        where: { OR: [{ name: { startsWith: PB } }, { trigger: { startsWith: PB } }] },
        select: { id: true, name: true, isEnabled: true, steps: true },
      });
    const pbs = await ourPlaybooks();
    check("las propuestas sin aprobar se borraron", pbs.filter((p) => p.name.includes("(propuesta)")).map((p) => p.id).join() === approvedOff.id, pbs);
    check("los básicos repetidos quedaron apagados", pbs.filter((p) => ["Agendar", "Primer contacto"].includes(p.name)).every((p) => !p.isEnabled), pbs);
    check("el básico editado sigue prendido", Boolean(pbs.find((p) => p.name === "Chat con conversación previa")?.isEnabled), pbs);
    const precios = pbs.find((p) => p.name === `${PB}Precios`);
    check("el de Dayana sigue prendido, sin la referencia", Boolean(precios?.isEnabled) && precios?.steps === "Nunca des valores; ofrécele la llamada gratis.", precios);
    check("la memoria de la IA se borró", (await prisma.whatsAppMemory.count({ where: { phone: WORK } })) === 0);
    check("la nota de Dayana se quedó", (await prisma.whatsAppMemory.count({ where: { phone: NOTED } })) === 1);
    const modeOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { aiMode: true } })).aiMode;
    check("el Copiloto pegado se soltó", (await modeOf(work.conv.id)) === "AUTO");
    check("el Copiloto que eligió Dayana se quedó", (await modeOf(chosen.conv.id)) === "COPILOT");

    console.log("\n3. Dos limpiezas seguidas y deshacer");
    // Dayana edita su procedimiento después de limpiar, y se limpia otra vez.
    await prisma.whatsAppPlaybook.update({ where: { id: precios!.id }, data: { steps: "Nunca des valores. Invita a la llamada." } });
    await applyAiReset({ memories: true, staffId: null });
    applied = 2;
    await undoAiReset(null);
    applied = 1;
    check("deshacer la segunda deja la copia de la primera", (await lastAiResetBackup())?.at === result.backupAt);
    const undone = await undoAiReset(null);
    applied = 0;
    check("vuelven los ejemplos", (await prisma.whatsAppReplyExample.count({ where: { replyText: quick } })) === 5);
    check("vuelve la memoria", (await prisma.whatsAppMemory.count({ where: { phone: WORK } })) === 1);
    const pbsBack = await ourPlaybooks();
    check(
      "vuelven las propuestas y los básicos prendidos",
      pbsBack.filter((p) => p.name.includes("(propuesta)")).length === 3 &&
        pbsBack.filter((p) => ["Agendar", "Primer contacto"].includes(p.name)).every((p) => p.isEnabled),
      pbsBack
    );
    check(
      "lo que Dayana editó después no se pisa",
      pbsBack.find((p) => p.name === `${PB}Precios`)?.steps === "Nunca des valores. Invita a la llamada." && (undone?.skippedPlaybooks ?? 0) >= 1,
      { pbsBack, undone }
    );
    check(
      "vuelve lo que había en desarrollo",
      (await prisma.whatsAppMemory.count({ where: { phone: { in: [...before.memories, WORK, NOTED] } } })) === before.memories.length + 2
    );
    check(
      "y el modo de los chats",
      (await prisma.conversation.count({ where: { id: { in: [...before.sticky, work.conv.id, chosen.conv.id] }, aiMode: "COPILOT" } })) ===
        before.sticky.length + 2
    );
  } finally {
    for (; applied > 0; applied--) await undoAiReset(null).catch((e: unknown) => console.error("no se pudo deshacer", e));
    await cleanup();
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Empezar limpio: todo bien");
};

main();
