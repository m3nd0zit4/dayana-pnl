/**
 * Registro de interés en el taller desde la página (`workshop-registration.ts`,
 * dueña 28-oct: «la gente que oprime ahí en taller se registra y se clasifica
 * como interesada; una vez clasificada, se le envía un mensaje automático»).
 * Contra la base de DESARROLLO, con un taller y personas de prueba que se
 * borran al final. Envío de mentira: no sale nada a WhatsApp, y la plantilla
 * no se manda a aprobar (no se llama a 360dialog).
 *
 *   bun --env-file=/e/Dev/Dayana/dayana-pnl/.env scripts/workshop-registration-e2e.ts
 *
 * 1. Se registra (escribió hace 1 h): contacto con la etiqueta y el detalle de
 *    origen, su chat de siempre, la fila en «Interesadas» (marca de la página)
 *    y UN WhatsApp de texto (su nombre, el taller, la pregunta del cupo o la
 *    llamada, sin precio ni enlace) con `source` `asistente:taller:<edición>`.
 * 2. Se registra otra vez: «ya tenías tu registro» y ningún mensaje más.
 * 3. Ya pagó la edición: «ya tienes tu cupo», ni fila ni mensaje.
 * 4. Pidió la baja / número personal (ignorado) / chat personal / clienta: no sale.
 * 5. Fuera de las 24 h sin la plantilla aprobada: no sale, queda «espera la
 *    plantilla» y se pide aprobarla (UNA llamada, de mentira). Aprobada como
 *    Utilidad: sale con ella. Aprobada como Marketing: no sale sola, y se dice.
 * 6. Tope por edición: pasado, no sale (con el motivo).
 * 7. Ya le escribimos hoy por este taller: no otra vez.
 * 8. Preguntó antes por WhatsApp («No le interesa» marcado): vuelve a «Nuevo»,
 *    conserva su mensaje y recibe el del registro.
 * 9. Su respuesta sigue lo del taller (`workshopLeadActive`, la pregunta del
 *    cupo) y la fila está en «Interesadas» con el estado del WhatsApp.
 * 10. «Que la IA le escriba» a quien esperaba la plantilla: la del registro
 *     (no «retomar la conversación») y la marca de la página se conserva.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  process.env.NOTIFICATIONS_DRY_RUN = "true";
  const { prisma } = await import("@/lib/db");
  const { registerWorkshopInterest, sendWorkshopRegistrationWhatsApp, loadRegistrationEdition } = await import("@/lib/crm/workshop-registration");
  const { PAGE_REGISTRATION_MESSAGE, REGISTRATION_TEMPLATE_BODY, REGISTRATION_TEMPLATE_KEY, registrationClientKey, WORKSHOP_INTEREST_TAG_SLUG } =
    await import("@/lib/crm/workshop-registration-rules");
  const { listWorkshopInterests } = await import("@/lib/crm/workshop-interests");
  const { offerWorkshopCall } = await import("@/lib/crm/workshop-interest-offer");
  const { ignoreNumbers, unignoreNumber } = await import("@/lib/crm/whatsapp-ignored-numbers");
  const { WORKSHOP_CHOICE, workshopFollowLine, workshopLeadActive, workshopOutreachSource, wantsWorkshopSpot } = await import(
    "@/lib/crm/whatsapp-agent/workshop-interest"
  );

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  const run = Date.now().toString().slice(-6);
  const ago = (h: number) => new Date(Date.now() - h * 3600_000);
  const productId = `taller-e2e-registro-${run}`;
  await prisma.product.create({
    data: {
      id: productId,
      kind: "WORKSHOP",
      title: "Tu Sanacion con el Dinero",
      sessionsLabel: "Taller en vivo",
      isActive: true,
      prices: { create: [{ currency: "COP", amountMinor: 190000 }, { currency: "USD", amountMinor: 6000 }] },
    },
  });
  const created = await prisma.workshopEdition.create({
    data: {
      productId,
      slug: `e2e-registro-${run}`,
      title: "Tu Sanacion con el Dinero",
      status: "OPEN",
      startsAt: new Date(Date.now() + 20 * 24 * 3600_000),
      startsAtHasTime: false,
      timezone: "America/Bogota",
      scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
    },
  });

  // Números de Colombia válidos (+57 31x…), uno por persona.
  const phoneOf = (n: string) => `+5731${run}${n}`;
  const contactIds = new Set<string>();
  const threads: string[] = [];
  const ignored: string[] = [];
  let tmpTemplate: { id: string } | null = null;

  const sent: { conversationId: string; body: string; source?: string | null; clientKey?: string | null; template?: unknown }[] = [];
  const tpl = (m: { template?: unknown } | undefined) => (m?.template ?? null) as { name?: string; variables?: unknown } | null;
  const fakeSend = async (input: {
    conversationId: string;
    body: string;
    source?: string | null;
    isAutoReply?: boolean;
    clientKey?: string | null;
    template?: unknown;
  }) => {
    sent.push(input);
    const m = await prisma.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        kind: "message",
        body: input.body,
        source: input.source ?? null,
        isAutoReply: input.isAutoReply ?? false,
        clientKey: input.clientKey ?? null,
        status: "SENT",
      },
    });
    return { messageId: m.id, externalMessageId: null, dryRun: true };
  };
  const submitted: string[][] = [];
  const deps = { send: fakeSend, ensureTemplates: async (keys: string[]) => void submitted.push(keys) };

  /** Una persona que ya tiene chat (y quizá contacto): escribió hace `hours` horas. */
  const chat = async (
    n: string,
    opts: { firstName: string; hours: number; optedOut?: boolean; category?: string; segment?: string; stage?: string; body?: string }
  ) => {
    const phone = phoneOf(n);
    const c = await prisma.contact.create({
      data: {
        phoneE164: phone,
        phoneCountryIso: "CO",
        firstName: opts.firstName,
        lastName: "Prueba",
        source: "WHATSAPP_DIRECT",
        notifyWhatsapp: !opts.optedOut,
      },
    });
    contactIds.add(c.id);
    threads.push(phone.slice(1));
    const conv = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: phone.slice(1),
        metaAccountId: "test-phone-id",
        participantName: `${opts.firstName} Prueba`,
        contactId: c.id,
        lastInboundAt: ago(opts.hours),
        ...(opts.category ? { category: opts.category, categorySource: "manual" } : {}),
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        direction: "INBOUND",
        kind: "message",
        body: opts.body ?? "Hola, vi tu video en TikTok",
        sentAt: ago(opts.hours),
        status: "RECEIVED",
      },
    });
    if (opts.segment) {
      await prisma.whatsAppDossier.create({
        data: { conversationId: conv.id, segment: opts.segment, stage: opts.stage ?? null, segmentSource: "manual" },
      });
    }
    return { contactId: c.id, conversationId: conv.id, phone };
  };

  const form = (n: string, firstName: string, extra: Partial<{ email: string; consentMarketing: boolean }> = {}) => ({
    firstName,
    lastName: "Prueba",
    email: extra.email ?? null,
    phone: phoneOf(n),
    phoneCountry: "CO",
    consentMarketing: extra.consentMarketing ?? false,
    ref: "enlaces",
  });

  /** Registrarse y, como la ruta, mandar el WhatsApp si es un registro nuevo. */
  const register = async (n: string, firstName: string, extra: Parameters<typeof form>[2] = {}, sendDeps: Partial<typeof deps> & { cap?: { perHour: number; perDay: number } } = {}) => {
    const r = await registerWorkshopInterest(edition, form(n, firstName, extra));
    contactIds.add(r.contactId);
    threads.push(phoneOf(n).slice(1));
    const s =
      r.status === "registered" && !r.alreadyRegistered
        ? await sendWorkshopRegistrationWhatsApp(
            { editionId: edition.id, interestId: r.interestId, contactId: r.contactId, firstName: r.firstName },
            { ...deps, ...sendDeps }
          )
        : null;
    return { r, s };
  };
  const rowOf = async (conversationId: string) =>
    (
      await prisma.$queryRaw<{ id: string; first_message: string; offered_via: string | null; offered_at: Date | null; status: string; asks: number }[]>`
        SELECT id, first_message, offered_via, offered_at, status, asks FROM workshop_interests
        WHERE edition_id = ${created.id} AND conversation_id = ${conversationId}`
    )[0] ?? null;

  const edition = (await loadRegistrationEdition(created.slug))!;

  try {
    check("0. la edición abierta se puede registrar, con su enlace de pago", edition.open && edition.payPath === `/pagar/p/${productId}`, edition);

    // 1. Ana escribió hace 1 h: registro + un mensaje de texto.
    const ana = await chat("01", { firstName: "Ana", hours: 1 });
    const a1 = await register("01", "Ana", { email: `e2e-registro-${run}@example.com`, consentMarketing: true });
    const rowA = await rowOf(ana.conversationId);
    const contactA = await prisma.contact.findUnique({
      where: { id: ana.contactId },
      select: { consentMarketingAt: true, sourceDetail: true, email: true, notes: true, tags: { select: { tag: { select: { slug: true } } } } },
    });
    const msgA = sent.find((m) => m.conversationId === ana.conversationId);
    check(
      "1. se registra: su mismo chat, la fila de la página, contacto con etiqueta, detalle de origen y su segundo permiso",
      a1.r.status === "registered" &&
        a1.r.conversationId === ana.conversationId &&
        !a1.r.alreadyRegistered &&
        rowA?.first_message === PAGE_REGISTRATION_MESSAGE &&
        Boolean(contactA?.tags.some((t) => t.tag.slug === WORKSHOP_INTEREST_TAG_SLUG)) &&
        contactA?.sourceDetail === "Interés en taller: Tu Sanacion con el Dinero (Enlaces)" &&
        Boolean(contactA?.consentMarketingAt) &&
        Boolean(contactA?.notes?.includes("Se registró en la página del taller")),
      { a1, rowA, contactA }
    );
    check(
      "   un WhatsApp de texto: «Hola Ana 🙏», el registro, la pregunta del cupo o la llamada; sin precio ni enlace; su source y su clave",
      a1.s?.status === "sent" &&
        a1.s.via === "text" &&
        sent.length === 1 &&
        Boolean(msgA?.body.startsWith("Hola Ana 🙏 Soy la asistente de Dayana Beltrán.")) &&
        Boolean(msgA?.body.includes("Recibimos tu registro para el taller «Tu Sanacion con el Dinero»")) &&
        Boolean(msgA?.body.endsWith(WORKSHOP_CHOICE)) &&
        !/https?:|\$|190|COP|USD/.test(msgA?.body ?? "") &&
        msgA?.source === workshopOutreachSource(edition) &&
        msgA?.clientKey === registrationClientKey(edition.id, ana.conversationId) &&
        !tpl(msgA),
      { s: a1.s, msgA }
    );
    const rowA1 = await rowOf(ana.conversationId);
    check("   la fila queda «pagina:text», con la fecha y en «Contactada»", rowA1?.offered_via === "pagina:text" && Boolean(rowA1.offered_at) && rowA1.status === "contactada", rowA1);

    // 2. Otra vez: ya tenía el registro, nada más sale (también si se llama al envío otra vez).
    const a2 = await register("01", "Ana");
    const again = await sendWorkshopRegistrationWhatsApp({ editionId: edition.id, interestId: rowA1!.id, contactId: ana.contactId, firstName: "Ana" }, deps);
    check(
      "2. otra vez: «ya tenías tu registro» y ningún WhatsApp más (el reclamo no deja)",
      a2.r.status === "registered" && a2.r.alreadyRegistered && a2.s === null && again.status === "skipped" && again.state === "already" && sent.length === 1,
      { a2, again, sent: sent.length }
    );

    // 3. Beatriz ya pagó esta edición.
    const bea = await chat("02", { firstName: "Beatriz", hours: 1 });
    await prisma.enrollment.create({ data: { contactId: bea.contactId, productId, workshopEditionId: edition.id, status: "ACTIVE" } });
    const b = await register("02", "Beatriz");
    check(
      "3. ya pagó: «ya tienes tu cupo», ni fila ni WhatsApp",
      b.r.status === "enrolled" && b.s === null && !(await rowOf(bea.conversationId)) && !sent.some((m) => m.conversationId === bea.conversationId),
      b
    );

    // 4. Baja, número ignorado, chat personal, clienta.
    const car = await chat("03", { firstName: "Carla", hours: 1, optedOut: true });
    const c = await register("03", "Carla");
    const dia = phoneOf("04");
    ignored.push(dia);
    await ignoreNumbers([dia.slice(1)], "manual");
    const d = await register("04", "Diana");
    const diaChat = await prisma.conversation.findFirst({ where: { channel: "WHATSAPP", externalThreadId: dia.slice(1) } });
    const ele = await chat("05", { firstName: "Elena", hours: 1, category: "personal" });
    const e = await register("05", "Elena");
    const fab = await chat("06", { firstName: "Fabiola", hours: 1, category: "cliente", segment: "client", stage: "clienta_activa" });
    const f = await register("06", "Fabiola");
    check(
      "4. pidió la baja / número personal ignorado (ni chat ni fila) / chat personal / clienta: no sale",
      c.s?.status === "skipped" &&
        c.s.state === "baja" &&
        (await rowOf(car.conversationId))?.offered_via === "pagina:baja" &&
        d.r.status === "personal" &&
        !diaChat &&
        e.s?.status === "skipped" &&
        e.s.state === "personal" &&
        f.s?.status === "skipped" &&
        f.s.state === "clienta" &&
        !sent.some((m) => [car.conversationId, ele.conversationId, fab.conversationId].includes(m.conversationId)),
      { c, d, diaChat: diaChat?.id, e, f }
    );

    // 5. Gloria nunca escribió: fuera de las 24 h, sin la plantilla aprobada.
    const g = await register("07", "Gloria");
    const gConv = g.r.status === "registered" ? g.r.conversationId : "";
    check(
      "5. fuera de las 24 h sin la plantilla: no sale, «espera la plantilla», su chat se crea, se pide aprobarla una vez",
      g.s?.status === "skipped" &&
        g.s.state === "plantilla" &&
        Boolean(gConv) &&
        (await rowOf(gConv))?.offered_via === "pagina:plantilla" &&
        submitted.length === 1 &&
        submitted[0]?.[0] === REGISTRATION_TEMPLATE_KEY &&
        !sent.some((m) => m.conversationId === gConv),
      { g, submitted }
    );

    // Aprobada como Marketing (Meta la recategorizó): no sale sola, y se dice.
    tmpTemplate = await prisma.messageTemplate.create({
      data: {
        key: REGISTRATION_TEMPLATE_KEY,
        title: "Taller: registro en la página",
        body: REGISTRATION_TEMPLATE_BODY,
        metaTemplateName: REGISTRATION_TEMPLATE_KEY,
        metaTemplateLang: "es",
        metaApprovalStatus: "APPROVED",
        metaCategory: "MARKETING",
        metaVarNames: ["nombre", "taller", "fecha"],
      },
      select: { id: true },
    });
    const m = await register("08", "Marta");
    const mConv = m.r.status === "registered" ? m.r.conversationId : "";
    check(
      "   aprobada como Marketing: no se envía sola como marketing; queda «pagina:marketing»",
      m.s?.status === "skipped" && m.s.state === "marketing" && (await rowOf(mConv))?.offered_via === "pagina:marketing" && !sent.some((x) => x.conversationId === mConv),
      m
    );

    // Aprobada como Utilidad: Helena por plantilla.
    await prisma.messageTemplate.update({ where: { id: tmpTemplate.id }, data: { metaCategory: "UTILITY" } });
    const h = await register("09", "Helena");
    const hConv = h.r.status === "registered" ? h.r.conversationId : "";
    const msgH = sent.find((x) => x.conversationId === hConv);
    check(
      "   aprobada como Utilidad: sale con ella (su nombre, el taller, la fecha), la pregunta del cupo y su source",
      h.s?.status === "sent" &&
        h.s.via === "template" &&
        tpl(msgH)?.name === REGISTRATION_TEMPLATE_KEY &&
        JSON.stringify(tpl(msgH)?.variables).includes("Helena") &&
        JSON.stringify(tpl(msgH)?.variables).includes("«Tu Sanacion con el Dinero»") &&
        Boolean(msgH?.body.includes("Recibimos tu registro para el taller «Tu Sanacion con el Dinero»")) &&
        Boolean(msgH?.body.includes("¿Prefieres el enlace para separar tu cupo o agendar la llamada?")) &&
        msgH?.source === workshopOutreachSource(edition) &&
        (await rowOf(hConv))?.offered_via === "pagina:template",
      { h, msgH }
    );

    // 6. Tope: ya salieron 2 en esta hora (Ana y Helena); con un tope de 2, Isabel no.
    const isa = await chat("10", { firstName: "Isabel", hours: 1 });
    const i = await register("10", "Isabel", {}, { cap: { perHour: 2, perDay: 100 } });
    check(
      "6. pasado el tope por edición: no sale, queda «pagina:tope»",
      i.s?.status === "skipped" && i.s.state === "tope" && (await rowOf(isa.conversationId))?.offered_via === "pagina:tope" && !sent.some((x) => x.conversationId === isa.conversationId),
      i
    );

    // 7. A Karen la IA ya le escribió hoy por este taller (otro mensaje con la misma source).
    const kar = await chat("11", { firstName: "Karen", hours: 1 });
    await prisma.conversationMessage.create({
      data: {
        conversationId: kar.conversationId,
        direction: "OUTBOUND",
        kind: "message",
        body: "Sobre el taller…",
        source: workshopOutreachSource(edition),
        isAutoReply: true,
        status: "SENT",
        sentAt: ago(2),
      },
    });
    const k = await register("11", "Karen");
    check("7. ya le escribimos hoy por este taller: no otra vez", k.s?.status === "skipped" && k.s.state === "ya_escrito" && !sent.some((x) => x.conversationId === kar.conversationId), k);

    // 8. Julia preguntó por WhatsApp hace días y Dayana la marcó «No le interesa».
    const jul = await chat("12", { firstName: "Julia", hours: 2, body: "¿Cuánto cuesta el taller de la sanación con el dinero?" });
    await prisma.$executeRaw`
      INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, updated_at)
      VALUES (${`e2e-${run}-jul`}, ${edition.id}, ${jul.conversationId}, ${"¿Cuánto cuesta el taller de la sanación con el dinero?"}, ${ago(50)}, ${ago(50)}, 1, 'descartada', NOW())`;
    const j = await register("12", "Julia");
    const rowJ = await rowOf(jul.conversationId);
    check(
      "8. ya estaba en «Interesadas» por WhatsApp: no es «ya registrada», conserva su mensaje, vuelve a «Nuevo» → «Contactada» y recibe el WhatsApp",
      j.r.status === "registered" &&
        !j.r.alreadyRegistered &&
        rowJ?.first_message.startsWith("¿Cuánto cuesta") === true &&
        rowJ.asks === 2 &&
        rowJ.status === "contactada" &&
        rowJ.offered_via === "pagina:text" &&
        j.s?.status === "sent",
      { j, rowJ }
    );

    // 9. Ana contesta «Quiero separar mi cupo»: sigue lo del taller; en «Interesadas» con su estado.
    await prisma.conversationMessage.create({
      data: { conversationId: ana.conversationId, direction: "INBOUND", kind: "message", body: "Quiero separar mi cupo", status: "RECEIVED" },
    });
    await prisma.conversation.update({ where: { id: ana.conversationId }, data: { lastInboundAt: new Date() } });
    const lines = await prisma.conversationMessage.findMany({
      where: { conversationId: ana.conversationId },
      orderBy: { sentAt: "asc" },
      select: { direction: true, body: true, sentAt: true, source: true },
    });
    check(
      "9. su respuesta es del taller (workshopLeadActive), es elegir el cupo y la IA sigue la pregunta del cupo o la llamada",
      workshopLeadActive(lines, edition) &&
        wantsWorkshopSpot("Quiero separar mi cupo", { afterChoice: true }) &&
        workshopFollowLine(lines, edition).includes("le preguntamos si quiere separar su cupo"),
      lines.map((l) => [l.direction, l.source, l.body?.slice(0, 40)])
    );
    const list = await listWorkshopInterests(edition.id);
    const by = (conv: string) => list.find((r) => r.conversationId === conv);
    check(
      "   «Interesadas»: Ana «Se registró en la página» con «WhatsApp enviado»; Gloria espera la plantilla; Marta, pasada a Marketing; Carla, baja; Isabel, tope; Julia con su mensaje",
      by(ana.conversationId)?.registration?.kind === "sent" &&
        by(ana.conversationId)?.registration?.label === "WhatsApp enviado" &&
        by(ana.conversationId)?.pageOnly === true &&
        by(gConv)?.registration?.kind === "pending" &&
        by(gConv)?.registration?.label === "WhatsApp: espera la plantilla" &&
        by(mConv)?.registration?.label === "WhatsApp: Meta pasó la plantilla a Marketing" &&
        by(car.conversationId)?.registration?.detail === "Pidió no recibir WhatsApp." &&
        Boolean(by(isa.conversationId)?.registration?.detail?.startsWith("Tope")) &&
        by(hConv)?.registration?.label === "WhatsApp enviado (plantilla)" &&
        by(jul.conversationId)?.pageOnly === false &&
        by(jul.conversationId)?.registration?.kind === "sent" &&
        !by(bea.conversationId),
      list.map((r) => ({ name: r.name, registration: r.registration, pageOnly: r.pageOnly }))
    );

    // 10. «Que la IA le escriba» a Gloria (esperaba la plantilla, ahora aprobada como Utilidad).
    const gRow = await rowOf(gConv);
    const before = sent.length;
    const offer = await offerWorkshopCall({ editionId: edition.id, interestId: gRow!.id }, { send: fakeSend });
    const msgG = sent.slice(before).find((x) => x.conversationId === gConv);
    const gRow2 = await rowOf(gConv);
    const gList = (await listWorkshopInterests(edition.id)).find((r) => r.conversationId === gConv);
    check(
      "10. «Que la IA le escriba» a quien se registró y nunca escribió: la plantilla del registro (no «retomar»), y conserva la marca de la página",
      offer.status === "sent" &&
        offer.via === "template" &&
        tpl(msgG)?.name === REGISTRATION_TEMPLATE_KEY &&
        !/retomar/i.test(msgG?.body ?? "") &&
        gRow2?.offered_via === "pagina:template" &&
        gList?.registration?.kind === "sent",
      { offer, msgG, gRow2, gList: gList?.registration }
    );
  } finally {
    await prisma.$executeRaw`DELETE FROM workshop_interests WHERE edition_id = ${created.id}`;
    const convs = await prisma.conversation.findMany({
      where: { channel: "WHATSAPP", OR: [{ contactId: { in: [...contactIds] } }, { externalThreadId: { in: threads } }] },
      select: { id: true },
    });
    const convIds = convs.map((x) => x.id);
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.enrollment.deleteMany({ where: { contactId: { in: [...contactIds] } } });
    await prisma.contactTag.deleteMany({ where: { contactId: { in: [...contactIds] } } });
    await prisma.contactTouch.deleteMany({ where: { contactId: { in: [...contactIds] } } }).catch(() => undefined);
    await prisma.contact.deleteMany({ where: { id: { in: [...contactIds] } } });
    for (const p of ignored) await unignoreNumber(p.slice(1)).catch(() => undefined);
    await prisma.workshopEdition.delete({ where: { id: created.id } });
    await prisma.productPrice.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
    if (tmpTemplate) await prisma.messageTemplate.delete({ where: { id: tmpTemplate.id } });
    await prisma.$disconnect();
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron: ${failures.join(", ")}` : "\n✅ Todo bien");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
