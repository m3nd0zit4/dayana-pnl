/**
 * El seguimiento del cierre (`quote-follow-up.ts`): a quien Dayana ya le mandó
 * cómo pagar y no ha pagado, el 1º y el 2º mensaje. Contra la base de
 * DESARROLLO, con un envío DE MENTIRA (no sale ningún WhatsApp) y sin modelo.
 *
 *   bun scripts/whatsapp-quote-follow-up-e2e.ts
 *
 * 1. Cotizada hace 3 días, contestó «Gracias»: le toca el 1º (el texto de
 *    «cotizada», con el `source` del seguimiento).
 * 2. Con el 1º enviado hace 1 día: nada (el 2º es a los 4 días).
 * 3. Dijo «la otra semana te pago»: no le toca hasta el día siguiente.
 * 4. En favoritos (Dayana lo está llevando): nada.
 * 5. Un comprobante sin revisar: nada.
 * 6. Solo los datos de Bancolombia (sin enlace): cuenta igual, el 1º.
 * 7. Dijo «la primera semana del próximo mes» y la asistente le reenvió el
 *    enlace: sigue esperando esa fecha (lo de la asistente no reinicia nada).
 * 8. El 1º no le llegó y Dayana lo borró o lo reenvió: no sale otra vez.
 * 9. El 1º no le llegó y sigue en el chat: no se reintenta en cada pasada.
 * 10. Al 1º contestó «no he tenido el dinero» (Andrea, 23-oct): el 2º, 7 días
 *     después, con lo más económico que hay (el taller abierto, la comunidad) y
 *     sus enlaces; fuera de las 24 h, `retomar_conversacion` con eso en `{{mensaje}}`.
 * 11. Lo dijo antes del 1º (que ya llevó lo más económico) y no contestó: el 2º
 *     es el de siempre, no le repite la oferta.
 */
export {};

process.env.NOTIFICATIONS_DRY_RUN = "true";

const main = async () => {
  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { sweepQuoteFollowUps } = await import("@/lib/crm/whatsapp-agent/quote-follow-up");
  const { QUOTE_FOLLOW_UP_SOURCE } = await import("@/lib/crm/whatsapp-agent/quote-follow-up-rules");
  const { zonedDateTimeToUtc, getDateKeyInTz } = await import("@/lib/datetime/zoned-time");

  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    if (!ok) failures.push(name);
  };

  const TZ = "America/Bogota";
  // Hoy a las 11:00 a. m. de Colombia: dentro del horario de envío.
  const now = zonedDateTimeToUtc(getDateKeyInTz(new Date(), TZ), "11:00", TZ);
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const base = await getWhatsAppAiConfig();
  const config = {
    ...base,
    defaultMode: "AUTO" as const,
    router: { ...base.router, enabled: true, modes: { ...base.router.modes, after_call: "AUTO" as const } },
    quoteFollowUp: { enabled: true, firstAfterDays: 2, secondAfterDays: 4, max: 2, lookbackDays: 14 },
  };

  const run = String(Date.now()).slice(-5);
  const sent: { to: string; text: string; source: string; templateKey?: string | null; vars?: Record<string, string | null | undefined> }[] = [];
  const fakeSend = (async (input: {
    recipient: { phoneE164: string };
    text: string;
    source: string;
    templateKey?: string | null;
    vars?: Record<string, string | null | undefined>;
  }) => {
    sent.push({ to: input.recipient.phoneE164, text: input.text, source: input.source, templateKey: input.templateKey, vars: input.vars });
    return { status: "sent", mode: "text", conversationId: "x", messageId: "x", body: input.text };
  }) as never;

  const ids: string[] = [];
  const chat = async (suffix: string, lines: { dir: "IN" | "OUT"; body: string; at: Date; source?: string; ai?: boolean; failed?: boolean }[], extra: { priorityAt?: Date } = {}) => {
    const conv = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: `5730077${run}${suffix}`,
        metaAccountId: "test-phone-id",
        participantName: "Prueba Cierre",
        ...extra,
      },
    });
    ids.push(conv.id);
    for (const l of lines) {
      await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          direction: l.dir === "IN" ? "INBOUND" : "OUTBOUND",
          kind: "message",
          body: l.body,
          sentAt: l.at,
          isAutoReply: Boolean(l.ai),
          source: l.source ?? null,
          status: l.dir === "IN" ? "RECEIVED" : l.failed ? "FAILED" : "SENT",
        },
      });
    }
    return conv.id;
  };
  const QUOTE = "Tan pronto me envíes el comprobante de pago, agendamos día y hora que me digas https://www.dayanabeltran.com/pagar/p/therapy-3";
  const sweep = async (conversationId: string) => {
    sent.length = 0;
    return sweepQuoteFollowUps(config, now, { send: fakeSend, conversationIds: [conversationId] });
  };

  try {
    console.log("\n1. Cotizada hace 3 días y solo dijo «Gracias»: el 1º");
    const c1 = await chat("1", [
      { dir: "OUT", body: QUOTE, at: ago(3) },
      { dir: "IN", body: "Gracias", at: ago(3) },
    ]);
    const r1 = await sweep(c1);
    check("salió uno", sent.length === 1, { r1, sent });
    check("texto de «cotizada»", /¿Cuándo te gustaría empezar\?/.test(sent[0]?.text ?? ""), sent[0]?.text);
    check("source del seguimiento", Boolean(sent[0]?.source.startsWith(QUOTE_FOLLOW_UP_SOURCE)) && sent[0].source.endsWith(":1"), sent[0]?.source);
    check("plantilla para fuera de las 24 h", sent[0]?.templateKey === "seguimiento_proceso", sent[0]?.templateKey);

    console.log("\n2. Con el 1º enviado ayer: el 2º todavía no");
    const c2 = await chat("2", [
      { dir: "OUT", body: QUOTE, at: ago(4) },
      { dir: "IN", body: "Gracias", at: ago(4) },
      { dir: "OUT", body: "Hola, te bendigo 🙏 Dayana queda muy atenta…", at: ago(1), source: `${QUOTE_FOLLOW_UP_SOURCE}1:1`, ai: true },
    ]);
    const r2 = await sweep(c2);
    check("no salió nada: todavía no le toca", sent.length === 0 && "not_due" in r2, { r2, sent });

    console.log("\n3. Dijo «la otra semana te pago»: hasta después de esa fecha, nada");
    const c3 = await chat("3", [
      { dir: "OUT", body: QUOTE, at: ago(3) },
      { dir: "IN", body: "Sí, estoy decidida, la otra semana te pago", at: ago(2) },
      { dir: "OUT", body: "Qué bien. Dayana queda atenta.", at: ago(2), ai: true },
    ]);
    const r3 = await sweep(c3);
    check("no salió nada: todavía no le toca", sent.length === 0 && "not_due" in r3, { r3, sent });

    console.log("\n4. En favoritos: nada");
    const c4 = await chat("4", [{ dir: "OUT", body: QUOTE, at: ago(3) }, { dir: "IN", body: "Gracias", at: ago(3) }], { priorityAt: ago(1) });
    const r4 = await sweep(c4);
    check("no salió nada: silenciado", sent.length === 0 && "blocked" in r4, { r4, sent });

    console.log("\n5. Un comprobante sin revisar: nada");
    const c5 = await chat("5", [{ dir: "OUT", body: QUOTE, at: ago(3) }, { dir: "IN", body: "Gracias", at: ago(3) }]);
    await prisma.whatsAppPaymentReceipt.create({ data: { conversationId: c5, status: "pending", summary: "e2e" } as never });
    const r5 = await sweep(c5);
    check("no salió nada: comprobante por revisar", sent.length === 0 && ("blocked" in r5 || "not_after_call" in r5), { r5, sent });

    console.log("\n6. Solo los datos de Bancolombia, sin enlace (dueña, 22-oct): el 1º");
    const c6 = await chat("6", [
      { dir: "OUT", body: "Bancolombia ahorros 15460415745 a nombre de Prueba Uno", at: ago(3) },
      { dir: "OUT", body: "Paquete de 3 sesiones $510.000", at: new Date(ago(3).getTime() + 20_000) },
      { dir: "IN", body: "Gracias", at: new Date(ago(3).getTime() + 60_000) },
    ]);
    const r6 = await sweep(c6);
    check("salió uno", sent.length === 1, { r6, sent });

    console.log("\n7. Dijo cuándo empieza y la asistente le reenvió el enlace: sigue la fecha (no se reinicia)");
    const quoteAt = ago(3);
    const c7 = await chat("7", [
      { dir: "OUT", body: "https://www.dayanabeltran.com/pagar/p/therapy-6", at: quoteAt },
      { dir: "IN", body: "Ya quedamos para la primera semana del próximo mes", at: new Date(quoteAt.getTime() + 60_000) },
      {
        dir: "OUT",
        body: "Puedes hacer el pago por el enlace que te envió Dayana.\n\nhttps://www.dayanabeltran.com/pagar/p/therapy-6",
        at: new Date(quoteAt.getTime() + 90_000),
        ai: true,
      },
    ]);
    const r7 = await sweep(c7);
    check("no salió nada: todavía no le toca", sent.length === 0 && "not_due" in r7, { r7, sent });

    console.log("\n8. Cristina (26-oct): el 1º no le llegó (Meta) y Dayana lo borró: no sale otra vez");
    const c8 = await chat("8", [{ dir: "OUT", body: QUOTE, at: ago(3) }, { dir: "IN", body: "Gracias", at: ago(3) }]);
    await sweep(c8);
    const first = sent[0];
    check("antes de borrarlo, le tocaba el 1º", Boolean(first?.source.endsWith(":1")), sent);
    // Como lo dejaba la bitácora antes de guardar `source`: solo el texto.
    await prisma.auditLog.create({
      data: { action: "WHATSAPP_FAILED_DELETED", entityType: "WhatsAppChat", entityId: c8, changes: { messageId: "e2e", body: first?.text ?? "", failedReason: "User's number is part of an experiment" } },
    });
    const r8 = await sweep(c8);
    check("borrado (bitácora vieja, por el texto): no sale", sent.length === 0, { r8, sent });
    const c9 = await chat("9", [{ dir: "OUT", body: QUOTE, at: ago(3) }, { dir: "IN", body: "Gracias", at: ago(3) }]);
    await sweep(c9);
    const again = sent[0];
    await prisma.auditLog.create({
      data: { action: "WHATSAPP_FAILED_RESENT", entityType: "WhatsAppChat", entityId: c9, changes: { messageId: "e2e", body: "(otro texto)", source: again?.source ?? "" } },
    });
    const r9 = await sweep(c9);
    check("reenviado (bitácora con `source`): no sale", sent.length === 0, { r9, sent });

    console.log("\n9. Cristina (26-oct): el 1º no le llegó y sigue en el chat: no se reintenta en cada pasada");
    const quoteAt10 = ago(3);
    const c10 = await chat("10", [
      { dir: "OUT", body: QUOTE, at: quoteAt10 },
      { dir: "IN", body: "Gracias", at: ago(3) },
      { dir: "OUT", body: "Hola, te escribo de parte de Dayana…", at: ago(0.2), source: `${QUOTE_FOLLOW_UP_SOURCE}${quoteAt10.getTime()}:1`, ai: true, failed: true },
    ]);
    const r10 = await sweep(c10);
    check("fallido en el chat: no sale otra vez", sent.length === 0 && "blocked" in r10, { r10, sent });

    // Lo que hay hoy en la base de desarrollo (el taller abierto con su enlace, la comunidad de Ajustes).
    const { openWorkshopForAi } = await import("@/lib/crm/workshop-interests");
    const { communityLink } = await import("@/lib/crm/whatsapp-agent/community");
    const workshopUrl = (await openWorkshopForAi(now))?.payUrl ?? null;
    const communityUrl = communityLink(config);
    console.log(`\n10. Andrea (23/24-oct): al 1º contestó «no he tenido el dinero»: el 2º, con lo más económico (taller: ${workshopUrl ?? "no hay"}, comunidad: ${communityUrl ?? "no hay"})`);
    const quoteAt11 = ago(13);
    const c11 = await chat("11", [
      { dir: "OUT", body: QUOTE, at: quoteAt11 },
      { dir: "IN", body: "Gracias", at: ago(13) },
      { dir: "OUT", body: "Hola Andrea, te escribo de parte de Dayana…", at: ago(11), source: `${QUOTE_FOLLOW_UP_SOURCE}${quoteAt11.getTime()}:1`, ai: true },
      { dir: "IN", body: "Buenas tardes. Sumercé es que no le he dado respuesta ya que no he tenido el dinero", at: ago(8) },
      { dir: "OUT", body: "Entiendo, te bendigo. Cuando tengas la posibilidad, nos avisas por aquí.", at: ago(8), ai: true },
    ]);
    const r11 = await sweep(c11);
    const s11 = sent[0];
    check("salió el 2º", sent.length === 1 && Boolean(s11?.source.endsWith(":2")), { r11, sent });
    if (workshopUrl || communityUrl) {
      check("no pregunta «¿Cuándo te gustaría empezar?»", !/cu[aá]ndo te gustar[ií]a empezar/i.test(s11?.text ?? ""), s11?.text);
      check("ofrece lo más económico", /más económic|gratis/.test(s11?.text ?? ""), s11?.text);
      if (workshopUrl) check("el taller primero, con su enlace", (s11?.text ?? "").includes(workshopUrl) && /taller/.test(s11?.text ?? ""), s11?.text);
      if (communityUrl) check("la comunidad, con su enlace", (s11?.text ?? "").includes(communityUrl), s11?.text);
      check("fuera de las 24 h: retomar_conversacion", s11?.templateKey === "retomar_conversacion", s11?.templateKey);
      const mensaje = s11?.vars?.mensaje ?? "";
      check("{{mensaje}}: una línea de hasta 300, con el primer enlace entero", mensaje.length <= 300 && !/\n/.test(mensaje) && mensaje.includes(workshopUrl ?? communityUrl ?? "#"), mensaje);
    } else {
      check("sin nada más económico: el de siempre", s11?.templateKey === "seguimiento_proceso", s11);
    }

    console.log("\n11. Lo dijo antes del 1º (que ya le ofreció lo más económico) y no contestó: el 2º es el de siempre");
    const quoteAt12 = ago(13);
    const c12 = await chat("12", [
      { dir: "OUT", body: QUOTE, at: quoteAt12 },
      { dir: "IN", body: "Ahorita no me alcanza", at: ago(12) },
      { dir: "OUT", body: "Hola, te bendigo 🙏 ¿Cómo has estado? … Mientras tanto, hay dos opciones más económicas…", at: ago(5), source: `${QUOTE_FOLLOW_UP_SOURCE}${quoteAt12.getTime()}:1`, ai: true },
    ]);
    const r12 = await sweep(c12);
    check(
      "el 2º de siempre (no repite la oferta)",
      sent.length === 1 && sent[0].templateKey === "seguimiento_proceso" && !/más económic/.test(sent[0].text),
      { r12, sent }
    );
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityType: "WhatsAppChat", entityId: { in: ids } } });
    await prisma.whatsAppPaymentReceipt.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
