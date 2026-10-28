/**
 * «Invitar a inscritas de eventos gratuitos» (`workshop-invite.ts`, dueña
 * 28-oct). Contra la base de DESARROLLO, con un taller, un evento y personas de
 * prueba que se borran al final. Envío de mentira: no sale nada a WhatsApp, y
 * la plantilla no se manda a aprobar (no se llama a 360dialog).
 *
 *   bun --env-file=/e/Dev/Dayana/dayana-pnl/.env scripts/workshop-invite-e2e.ts
 *
 * 1. La vista previa: le llega a quien aceptó recibir información de talleres;
 *    sin ese consentimiento, ya pagó, clienta, personal o pidió la baja, no
 *    (cada motivo contado); tampoco a quien ya le llegó otro mensaje del taller
 *    (un envío masivo, «Que la IA le escriba») ni dos veces al mismo chat
 *    (México 52 / 521). Quien no escribió en 24 h espera la plantilla. La
 *    vista previa no manda la plantilla a Meta.
 * 2. Enviar: si no cuadra con lo confirmado, no empieza. Dentro de las 24 h,
 *    el texto (de pago, la pregunta del cupo o la llamada, su nombre seguro,
 *    sin enlace ni valor) con `source` `asistente:taller:<edición>`. Quien pagó
 *    entre la vista previa y el envío: no. Al empezar, la plantilla a aprobar.
 * 3. Otra vez: a nadie dos veces; sin la plantilla aprobada, nada. Aprobada
 *    después de la vista previa: con lo confirmado (sin plantilla), tampoco.
 * 4. Fuera de las 24 h con la plantilla aprobada: la plantilla (y su chat se crea).
 * 5. Otra vez: no hay a quién.
 * 6. Su respuesta sigue lo del taller (`workshopLeadActive`) y entra en
 *    «Interesadas» con «La IA le escribió»; «No me interesa», marcada así.
 * 7. Ese mismo día, «Que la IA le escriba» no le vuelve a escribir.
 * 8. El envío masivo genérico no la continúa; la lista de invitadas.
 * 9. Al enviar también: el otro contacto del mismo chat y quien ya recibió otro
 *    mensaje del taller se saltan (y el chat no cambia de contacto).
 * 10. Una fila que quedó «enviándose» (la tanda se cortó): si su mensaje ya
 *     salió, se anota sin reenviarlo; si no, vuelve a la cola y sale una vez; una
 *     reciente no se toca y la tanda avisa que no avanza (`stalled`).
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  process.env.NOTIFICATIONS_DRY_RUN = "true";
  const { prisma } = await import("@/lib/db");
  const { previewWorkshopInvite, startWorkshopInvite, processWorkshopInviteBatch, listWorkshopInvitations, syncInviteReplies } =
    await import("@/lib/crm/workshop-invite");
  const { INVITE_TEMPLATE_KEY, INVITE_TEMPLATE_BODY, INVITE_SEND_KIND, inviteClientKey } = await import("@/lib/crm/workshop-invite-rules");
  const { listWorkshopInterests } = await import("@/lib/crm/workshop-interests");
  const { offerWorkshopCall } = await import("@/lib/crm/workshop-interest-offer");
  const { processNextBatch, WhatsAppSendSetupError } = await import("@/lib/crm/whatsapp-sends");
  const { WORKSHOP_CHOICE, workshopFlowActive, workshopFollowLine, workshopLeadActive, workshopOutreachSource } = await import(
    "@/lib/crm/whatsapp-agent/workshop-interest"
  );

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failures.push(name);
  };

  const run = Date.now().toString().slice(-6);
  const ago = (h: number) => new Date(Date.now() - h * 3600_000);
  const productId = `taller-e2e-invita-${run}`;
  await prisma.product.create({
    data: {
      id: productId,
      kind: "WORKSHOP",
      title: "Sana Tu Relacion con el Dinero",
      sessionsLabel: "Taller en vivo",
      isActive: true,
      prices: { create: [{ currency: "COP", amountMinor: 190000 }, { currency: "USD", amountMinor: 6000 }] },
    },
  });
  const edition = await prisma.workshopEdition.create({
    data: {
      productId,
      slug: `e2e-invita-${run}`,
      title: "Sana Tu Relacion con el Dinero",
      status: "OPEN",
      startsAt: new Date(Date.now() + 20 * 24 * 3600_000),
      startsAtHasTime: false,
      timezone: "America/Bogota",
      scheduleLabel: "8:30 a.m. – 4:30 p.m. · virtual",
    },
  });
  const webinar = await prisma.freeWebinar.create({
    data: {
      slug: `e2e-invita-webinar-${run}`,
      status: "COMPLETED",
      headline: "Webinar Gratuito",
      eventLabel: "Webinar Gratuito",
      startsAt: ago(72),
      learnItems: [],
    },
  });

  const contactIds: string[] = [];
  const threads: string[] = [];
  const person = async (
    suffix: string,
    opts: {
      firstName: string;
      consent: boolean;
      optedOut?: boolean;
      /** Otro número (México: +52 55…). */
      phone?: string;
      chat?: { lastInboundHoursAgo: number; category?: string; segment?: string; stage?: string; thread?: string };
    }
  ) => {
    const phone = opts.phone ?? `+5730077${run}${suffix}`;
    const c = await prisma.contact.create({
      data: {
        phoneE164: phone,
        phoneCountryIso: phone.startsWith("+52") ? "MX" : "CO",
        firstName: opts.firstName,
        lastName: "Prueba",
        source: "WEB_LEAD_FORM",
        sourceDetail: "Webinar gratuito",
        consentDataAt: new Date(),
        consentMarketingAt: opts.consent ? new Date() : null,
        notifyWhatsapp: !opts.optedOut,
      },
    });
    contactIds.push(c.id);
    threads.push(phone.slice(1));
    await prisma.webinarRegistration.create({ data: { webinarId: webinar.id, contactId: c.id } });
    let conversationId: string | null = null;
    if (opts.chat) {
      const thread = opts.chat.thread ?? phone.slice(1);
      threads.push(thread);
      const conv = await prisma.conversation.create({
        data: {
          channel: "WHATSAPP",
          externalThreadId: thread,
          metaAccountId: "test-phone-id",
          participantName: `${opts.firstName} Prueba`,
          contactId: c.id,
          lastInboundAt: ago(opts.chat.lastInboundHoursAgo),
          ...(opts.chat.category ? { category: opts.chat.category, categorySource: "manual" } : {}),
        },
      });
      conversationId = conv.id;
      await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          direction: "INBOUND",
          kind: "message",
          body: "Gracias, ahí estaré en el webinar",
          sentAt: ago(opts.chat.lastInboundHoursAgo),
          status: "RECEIVED",
        },
      });
      if (opts.chat.segment) {
        await prisma.whatsAppDossier.create({
          data: { conversationId: conv.id, segment: opts.chat.segment, stage: opts.chat.stage ?? null, segmentSource: "manual" },
        });
      }
    }
    return { id: c.id, conversationId };
  };

  const sent: { conversationId: string; body: string; source?: string | null; clientKey?: string | null; template?: unknown }[] = [];
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
  const submitted: string[] = [];
  const deps = {
    send: fakeSend,
    onlyEventIds: [webinar.id],
    submitTemplate: async (t: { key: string }) => void submitted.push(t.key),
    pauseMs: 0,
  };
  const staff = await prisma.staffUser.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  const staffId = staff?.id ?? "e2e";
  let tmpTemplate: { id: string } | null = null;
  // Un envío a mano de esta invitación (para las filas colgadas y las de otro chat).
  const manualSend = async (rows: { contactId: string; status: string; processedAt?: Date; conversationId?: string | null }[]) =>
    prisma.whatsAppSend.create({
      data: {
        title: "e2e",
        kind: INVITE_SEND_KIND,
        text: "e2e",
        status: "SENDING",
        total: rows.length,
        workshopEditionId: edition.id,
        vars: { includeTemplate: "0", maxTemplate: "0" },
        recipients: { create: rows.map((r) => ({ contactId: r.contactId, status: r.status, processedAt: r.processedAt ?? null, conversationId: r.conversationId ?? null })) },
      },
      select: { id: true },
    });

  try {
    const a = await person("1", { firstName: "Rosa", consent: true, chat: { lastInboundHoursAgo: 1 } });
    const b = await person("2", { firstName: "Beatriz", consent: true }); // sin chat: fuera de las 24 h
    await person("3", { firstName: "Carla", consent: false, chat: { lastInboundHoursAgo: 1 } });
    const d = await person("4", { firstName: "Diana", consent: true, chat: { lastInboundHoursAgo: 1 } });
    await prisma.enrollment.create({ data: { contactId: d.id, productId, workshopEditionId: edition.id, status: "ACTIVE" } });
    await person("5", { firstName: "Elena", consent: true, chat: { lastInboundHoursAgo: 1, category: "cliente", segment: "client", stage: "clienta_pasada" } });
    await person("6", { firstName: "Fabiola", consent: true, chat: { lastInboundHoursAgo: 1, category: "personal" } });
    await person("7", { firstName: "Gloria", consent: true, optedOut: true, chat: { lastInboundHoursAgo: 1 } });
    const h = await person("8", { firstName: "Helena", consent: true, chat: { lastInboundHoursAgo: 2 } });
    // Ya le llegó el envío masivo del taller (pestaña WhatsApp).
    const i = await person("9", { firstName: "Isabel", consent: true, chat: { lastInboundHoursAgo: 1 } });
    await prisma.whatsAppSend.create({
      data: {
        title: "Taller: invitación (envío masivo)",
        kind: "taller",
        text: "Hola",
        status: "DONE",
        total: 1,
        sent: 1,
        workshopEditionId: edition.id,
        recipients: { create: [{ contactId: i.id, status: "SENT", conversationId: i.conversationId, processedAt: ago(5) }] },
      },
    });
    // Ya le escribió la IA desde «Interesadas» («Que la IA le escriba»).
    const j = await person("0", { firstName: "Julia", consent: true, chat: { lastInboundHoursAgo: 1 } });
    await prisma.conversationMessage.create({
      data: {
        conversationId: j.conversationId!,
        direction: "OUTBOUND",
        kind: "message",
        body: "Sobre el taller…",
        source: workshopOutreachSource(edition),
        isAutoReply: true,
        status: "SENT",
        sentAt: ago(5),
      },
    });
    // México: el mismo chat con dos contactos (+52 55… y +521 55…).
    const mxThread = `52155${run}11`;
    const x = await person("x", { firstName: "Ximena", consent: true, phone: `+5255${run}11`, chat: { lastInboundHoursAgo: 1, thread: mxThread } });
    const y = await person("y", { firstName: "Yolanda", consent: true, phone: `+52155${run}11` });

    // 1. La vista previa.
    const p1 = await previewWorkshopInvite(edition.id, deps);
    const reasons = Object.fromEntries((p1?.excluded ?? []).map((e) => [e.reason, e.count]));
    check(
      "1. vista previa: le llega a 4 (3 por mensaje, 1 espera la plantilla); sin consentimiento, pagó, clienta, personal y baja: fuera",
      p1?.blocked === null &&
        p1.registered === 12 &&
        p1.eligible === 4 &&
        p1.viaText === 3 &&
        p1.viaTemplate === 1 &&
        !p1.template.approved &&
        p1.sendableNow === 3 &&
        reasons.no_consent === 1 &&
        reasons.paid === 1 &&
        reasons.client === 1 &&
        reasons.personal === 1 &&
        reasons.opted_out === 1,
      p1
    );
    check(
      "   ya le llegó otro mensaje del taller (envío masivo, «Que la IA le escriba») y el mismo chat de México: fuera",
      reasons.already_contacted === 2 && reasons.same_chat === 1,
      reasons
    );
    check("   la vista previa no manda la plantilla a Meta", submitted.length === 0, submitted);
    check("   el ejemplo dice que es de pago y hace la pregunta del cupo", Boolean(p1?.textExample.includes("Es un taller de pago.") && p1.textExample.endsWith(WORKSHOP_CHOICE)), p1?.textExample);

    // 2. Enviar. Lo confirmado no cuadra: no empieza.
    const wrong = await startWorkshopInvite({ editionId: edition.id, staffId, expect: { viaText: 5, viaTemplate: 1, includeTemplate: false } }, deps);
    check("2. con números distintos a los de la vista previa no empieza", wrong.status === "changed" && /Revisa la vista previa/.test(wrong.message), wrong);
    const expect1 = { viaText: p1!.viaText, viaTemplate: p1!.viaTemplate, includeTemplate: p1!.template.approved };
    const s1 = await startWorkshopInvite({ editionId: edition.id, staffId, expect: expect1 }, deps);
    check("   empieza con las 3 que pueden recibirla ahora; la dueña al empezar manda la plantilla a aprobar", s1.status === "started" && s1.total === 3 && submitted.includes(INVITE_TEMPLATE_KEY), { s1, submitted });
    // Helena paga entre la vista previa y el envío.
    await prisma.enrollment.create({ data: { contactId: h.id, productId, workshopEditionId: edition.id, status: "ACTIVE" } });
    const sendId1 = s1.status === "started" ? s1.sendId : "";
    const prog1 = await processWorkshopInviteBatch({ sendId: sendId1, staffId }, deps);
    const msgA = sent.find((m) => m.conversationId === a.conversationId);
    check(
      "   a Rosa: el texto, con su nombre, de pago, la pregunta del cupo o la llamada, sin enlace ni valor, como la asistente",
      Boolean(
        msgA &&
          msgA.body.startsWith("Hola Rosa 🙏 Soy la asistente de Dayana Beltrán.") &&
          msgA.body.includes("te inscribiste en su webinar gratuito del") &&
          msgA.body.includes("Es un taller de pago.") &&
          msgA.body.endsWith(WORKSHOP_CHOICE) &&
          !/https?:|\$|COP|USD/.test(msgA.body) &&
          msgA.source === workshopOutreachSource(edition) &&
          msgA.clientKey === inviteClientKey(edition.id, a.conversationId!) &&
          !msgA.template
      ),
      msgA
    );
    const rowsH = await prisma.whatsAppSendRecipient.findMany({ where: { sendId: sendId1, contactId: h.id } });
    check(
      "   Helena pagó mientras tanto: no se le escribe (se vuelve a mirar a cada persona)",
      !sent.some((m) => m.conversationId === h.conversationId) && rowsH[0]?.status === "SKIPPED" && Boolean(rowsH[0]?.error?.includes("pagaron")),
      rowsH
    );
    check("   al chat de México le llega una sola", sent.filter((m) => m.conversationId === x.conversationId).length === 1, sent.map((m) => m.conversationId));
    check("   el envío queda terminado: 2 enviadas, 1 no", prog1.status === "DONE" && prog1.sent === 2 && prog1.skipped === 1 && prog1.pending === 0, prog1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: sendId1, action: "WHATSAPP_BULK_CREATED" } });
    check("   queda en la auditoría", Boolean(audit), audit);

    // 3. Otra vez: a nadie dos veces; sin plantilla aprobada, nada.
    const p2 = await previewWorkshopInvite(edition.id, deps);
    const reasons2 = Object.fromEntries((p2?.excluded ?? []).map((e) => [e.reason, e.count]));
    const expect2 = { viaText: p2!.viaText, viaTemplate: p2!.viaTemplate, includeTemplate: p2!.template.approved };
    const s2 = await startWorkshopInvite({ editionId: edition.id, staffId, expect: expect2 }, deps);
    check(
      "3. otra vez: Rosa y el chat de México ya invitados, Helena ya pagó; Beatriz espera la plantilla, así que no se envía nada",
      reasons2.already_invited === 3 && reasons2.paid === 2 && p2?.eligible === 1 && p2.sendableNow === 0 && s2.status === "blocked" && /plantilla/.test(s2.message),
      { p2, s2 }
    );

    // 4. Con la plantilla aprobada (en desarrollo no existe: se crea un momento), Beatriz por plantilla.
    tmpTemplate = await prisma.messageTemplate.create({
      data: {
        key: INVITE_TEMPLATE_KEY,
        title: "Taller: invitación a inscritas de eventos gratuitos",
        body: INVITE_TEMPLATE_BODY,
        metaTemplateName: INVITE_TEMPLATE_KEY,
        metaTemplateLang: "es",
        metaApprovalStatus: "APPROVED",
        metaCategory: "MARKETING",
        metaVarNames: ["nombre", "taller", "fecha"],
      },
      select: { id: true },
    });
    // Aprobada después de la vista previa: con lo confirmado (sin plantilla) no sale ninguna plantilla.
    const stale = await startWorkshopInvite({ editionId: edition.id, staffId, expect: expect2 }, deps);
    check("   aprobada después de la vista previa: con lo confirmado no sale ninguna plantilla", stale.status === "blocked" && sent.length === 2, { stale, sent: sent.length });
    const p3 = await previewWorkshopInvite(edition.id, deps);
    const s3 = await startWorkshopInvite(
      { editionId: edition.id, staffId, expect: { viaText: p3!.viaText, viaTemplate: p3!.viaTemplate, includeTemplate: p3!.template.approved } },
      deps
    );
    const sendId3 = s3.status === "started" ? s3.sendId : "";
    await processWorkshopInviteBatch({ sendId: sendId3, staffId }, deps);
    const convB = await prisma.conversation.findFirst({ where: { contactId: b.id, channel: "WHATSAPP" }, select: { id: true } });
    const msgB = sent.find((m) => m.conversationId === convB?.id);
    const tpl = msgB?.template as { name?: string; variables?: string[] } | undefined;
    check(
      "4. fuera de las 24 h: la plantilla (su chat se crea), con su nombre, el taller y la fecha; de pago y con la pregunta",
      p3?.sendableNow === 1 &&
        s3.status === "started" &&
        Boolean(convB) &&
        tpl?.name === INVITE_TEMPLATE_KEY &&
        tpl.variables?.[0] === "Beatriz" &&
        tpl.variables?.[1] === "«Sana Tu Relacion con el Dinero»" &&
        Boolean(tpl.variables?.[2]?.endsWith("(hora de Colombia)")) &&
        Boolean(msgB?.body.includes("Es un taller de pago.")) &&
        msgB?.source === workshopOutreachSource(edition),
      { p3, s3, msgB }
    );

    // 5. Otra vez: no hay a quién.
    const p4 = await previewWorkshopInvite(edition.id, deps);
    const s4 = await startWorkshopInvite(
      { editionId: edition.id, staffId, expect: { viaText: p4!.viaText, viaTemplate: p4!.viaTemplate, includeTemplate: p4!.template.approved } },
      deps
    );
    check("5. otra vez: no hay a quién invitar", s4.status === "blocked" && /No hay a quién/.test(s4.message) && sent.length === 3, { s4, sent: sent.length });

    // 6. Contestan.
    await prisma.conversationMessage.create({
      data: { conversationId: a.conversationId!, direction: "INBOUND", kind: "message", body: "Quiero separar mi cupo", sentAt: new Date(Date.now() + 1000), status: "RECEIVED" },
    });
    await prisma.conversationMessage.create({
      data: { conversationId: convB!.id, direction: "INBOUND", kind: "message", body: "No me interesa, gracias", sentAt: new Date(Date.now() + 1000), status: "RECEIVED" },
    });
    const thread = await prisma.conversationMessage.findMany({
      where: { conversationId: a.conversationId! },
      orderBy: { sentAt: "asc" },
      select: { direction: true, body: true, sentAt: true, source: true, isAutoReply: true },
    });
    const ws = { ...edition, cardSummary: null, payUrl: `https://www.dayanabeltran.com/pagar/p/${productId}` };
    const later = Date.now() + 5000;
    check(
      "6. su «Quiero separar mi cupo» sigue lo del taller y va el enlace",
      workshopLeadActive(thread, ws, later) && workshopFlowActive(thread, ws, later) && workshopFollowLine(thread, ws, later).includes("send_workshop_link"),
      { line: workshopFollowLine(thread, ws, later) }
    );
    const synced = await syncInviteReplies(edition);
    const again = await syncInviteReplies(edition);
    const interests = await listWorkshopInterests(edition.id);
    const iA = interests.find((r) => r.conversationId === a.conversationId);
    const iB = interests.find((r) => r.conversationId === convB?.id);
    check(
      "   las dos respuestas entran en «Interesadas» con «La IA le escribió»; «No me interesa», marcada así; leer otra vez no suma",
      synced === 2 &&
        again === 0 &&
        iA?.status === "contactada" &&
        iA.offeredVia === "text" &&
        iA.offeredAt !== null &&
        iA.firstMessage === "Quiero separar mi cupo" &&
        iB?.status === "descartada" &&
        iB.offeredVia === "template",
      { synced, again, iA, iB }
    );

    // 7. Ese mismo día, «Que la IA le escriba» no le vuelve a escribir.
    const offer = await offerWorkshopCall({ editionId: edition.id, interestId: iA!.id }, { send: fakeSend });
    check("7. «Que la IA le escriba» el mismo día: ya le escribió", offer.status === "skipped" && offer.reason === "already" && sent.length === 3, offer);

    // 8. El envío masivo genérico no la continúa; la lista de invitadas.
    let refused = false;
    try {
      await processNextBatch(sendId1, staffId);
    } catch (e) {
      refused = e instanceof WhatsAppSendSetupError;
    }
    check("8. el envío masivo genérico no continúa una invitación", refused);
    const list = await listWorkshopInvitations(edition.id);
    const lA = list.find((r) => r.contactId === a.id);
    const lB = list.find((r) => r.contactId === b.id);
    const lH = list.find((r) => r.contactId === h.id);
    const lX = list.find((r) => r.contactId === x.id);
    check(
      "   la lista: Rosa, Ximena y Beatriz invitadas (Rosa y Beatriz respondieron), Helena sin enviar con el motivo",
      list.length === 4 &&
        lA?.status === "SENT" &&
        lA.mode === "text" &&
        lA.answeredAt !== null &&
        lB?.status === "SENT" &&
        lB.mode === "template" &&
        lX?.status === "SENT" &&
        lH?.status === "SKIPPED",
      list
    );
    const kinds = await prisma.whatsAppSend.findMany({ where: { workshopEditionId: edition.id, kind: INVITE_SEND_KIND }, select: { kind: true } });
    check("   los envíos quedan en la historia del taller", kinds.length === 2, kinds);

    // 9. Al enviar también: el otro contacto del mismo chat y quien ya recibió otro mensaje del taller.
    const m9 = await manualSend([
      { contactId: y.id, status: "PENDING" },
      { contactId: i.id, status: "PENDING" },
      { contactId: j.id, status: "PENDING" },
    ]);
    const before9 = sent.length;
    await processWorkshopInviteBatch({ sendId: m9.id, staffId }, deps);
    const rows9 = await prisma.whatsAppSendRecipient.findMany({ where: { sendId: m9.id }, select: { contactId: true, status: true, error: true } });
    const r9 = (id: string) => rows9.find((r) => r.contactId === id);
    const xConv = await prisma.conversation.findUnique({ where: { id: x.conversationId! }, select: { contactId: true } });
    check(
      "9. al enviar: Yolanda (mismo chat que Ximena) y quienes ya recibieron otro mensaje del taller se saltan; el chat sigue siendo de Ximena",
      sent.length === before9 &&
        r9(y.id)?.status === "SKIPPED" &&
        Boolean(r9(y.id)?.error?.includes("mismo chat")) &&
        r9(i.id)?.status === "SKIPPED" &&
        Boolean(r9(i.id)?.error?.includes("otro mensaje")) &&
        r9(j.id)?.status === "SKIPPED" &&
        xConv?.contactId === x.id,
      { rows9, xConv }
    );

    // 10. Filas colgadas en «enviándose».
    const k = await person("11", { firstName: "Karen", consent: true, chat: { lastInboundHoursAgo: 1 } });
    const l = await person("12", { firstName: "Laura", consent: true, chat: { lastInboundHoursAgo: 1 } });
    const mm = await person("13", { firstName: "Marta", consent: true, chat: { lastInboundHoursAgo: 1 } });
    // A Karen ya le salió (la tanda se cortó antes de anotarlo).
    const kMsg = await prisma.conversationMessage.create({
      data: {
        conversationId: k.conversationId!,
        direction: "OUTBOUND",
        kind: "message",
        body: "Hola Karen 🙏 …",
        source: workshopOutreachSource(edition),
        isAutoReply: true,
        clientKey: inviteClientKey(edition.id, k.conversationId!),
        status: "SENT",
        sentAt: ago(0.2),
      },
    });
    const m10 = await manualSend([
      { contactId: k.id, status: "SENDING", processedAt: ago(10 / 60) },
      { contactId: l.id, status: "SENDING", processedAt: ago(10 / 60) },
      { contactId: mm.id, status: "SENDING", processedAt: ago(1 / 60) },
    ]);
    const before10 = sent.length;
    const p10a = await processWorkshopInviteBatch({ sendId: m10.id, staffId }, deps);
    const rows10 = await prisma.whatsAppSendRecipient.findMany({ where: { sendId: m10.id }, select: { contactId: true, status: true, messageId: true } });
    const r10 = (id: string) => rows10.find((r) => r.contactId === id);
    const kMsgs = await prisma.conversationMessage.count({ where: { conversationId: k.conversationId!, direction: "OUTBOUND" } });
    check(
      "10. colgada y ya enviada: se anota sin reenviar; colgada sin enviar: sale una vez; la reciente no se toca",
      r10(k.id)?.status === "SENT" &&
        r10(k.id)?.messageId === kMsg.id &&
        kMsgs === 1 &&
        r10(l.id)?.status === "SENT" &&
        sent.length === before10 + 1 &&
        sent.filter((s) => s.conversationId === l.conversationId).length === 1 &&
        r10(mm.id)?.status === "SENDING" &&
        p10a.pending === 1 &&
        !p10a.stalled,
      { rows10, p10a, kMsgs }
    );
    const p10b = await processWorkshopInviteBatch({ sendId: m10.id, staffId }, deps);
    check("   la siguiente tanda no tiene nada que hacer: avisa que no avanza (la página deja de pedir)", p10b.stalled === true && p10b.pending === 1, p10b);
  } finally {
    const sends = await prisma.whatsAppSend.findMany({ where: { workshopEditionId: edition.id }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: sends.map((s) => s.id) } } });
    await prisma.whatsAppSend.deleteMany({ where: { id: { in: sends.map((s) => s.id) } } });
    await prisma.$executeRaw`DELETE FROM workshop_interests WHERE edition_id = ${edition.id}`;
    const convs = await prisma.conversation.findMany({
      where: { channel: "WHATSAPP", OR: [{ contactId: { in: contactIds } }, { externalThreadId: { in: threads } }] },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);
    await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: convIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
    await prisma.enrollment.deleteMany({ where: { contactId: { in: contactIds } } });
    await prisma.webinarRegistration.deleteMany({ where: { webinarId: webinar.id } });
    await prisma.contactTouch.deleteMany({ where: { contactId: { in: contactIds } } }).catch(() => undefined);
    await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    await prisma.freeWebinar.delete({ where: { id: webinar.id } });
    await prisma.workshopEdition.delete({ where: { id: edition.id } });
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
