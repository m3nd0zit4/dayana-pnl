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
 *    (cada motivo contado). Quien no escribió en 24 h espera la plantilla.
 * 2. Enviar: dentro de las 24 h, el texto (de pago, la pregunta del cupo o la
 *    llamada, su nombre seguro, sin enlace ni valor) con `source`
 *    `asistente:taller:<edición>`. Quien pagó entre la vista previa y el envío:
 *    no (se vuelve a mirar a cada persona).
 * 3. Otra vez: a nadie dos veces; sin la plantilla aprobada, no se envía nada.
 * 4. Fuera de las 24 h con la plantilla aprobada: la plantilla (y su chat se crea).
 * 5. Otra vez: no hay a quién.
 * 6. Su respuesta sigue lo del taller (`workshopLeadActive`) y entra en
 *    «Interesadas» con «La IA le escribió»; «No me interesa», marcada así.
 * 7. Ese mismo día, «Que la IA le escriba» no le vuelve a escribir.
 * 8. El envío masivo genérico no la continúa; la lista de invitadas.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  process.env.NOTIFICATIONS_DRY_RUN = "true";
  const { prisma } = await import("@/lib/db");
  const { previewWorkshopInvite, startWorkshopInvite, processWorkshopInviteBatch, listWorkshopInvitations, syncInviteReplies } =
    await import("@/lib/crm/workshop-invite");
  const { INVITE_TEMPLATE_KEY, INVITE_TEMPLATE_BODY, INVITE_SEND_KIND } = await import("@/lib/crm/workshop-invite-rules");
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
    opts: { firstName: string; consent: boolean; optedOut?: boolean; chat?: { lastInboundHoursAgo: number; category?: string; segment?: string; stage?: string } }
  ) => {
    const phone = `+5730077${run}${suffix}`;
    const c = await prisma.contact.create({
      data: {
        phoneE164: phone,
        phoneCountryIso: "CO",
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
      const conv = await prisma.conversation.create({
        data: {
          channel: "WHATSAPP",
          externalThreadId: phone.slice(1),
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
  const ensured: string[][] = [];
  const deps = { send: fakeSend, onlyEventIds: [webinar.id], ensureTemplates: async (keys: string[]) => void ensured.push(keys), pauseMs: 0 };
  const staff = await prisma.staffUser.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  const staffId = staff?.id ?? "e2e";
  let tmpTemplate: { id: string } | null = null;

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

    // 1. La vista previa.
    const p1 = await previewWorkshopInvite(edition.id, deps);
    const reasons = Object.fromEntries((p1?.excluded ?? []).map((e) => [e.reason, e.count]));
    check(
      "1. vista previa: le llega a 3 (2 por mensaje, 1 espera la plantilla); sin consentimiento, pagó, clienta, personal y baja: fuera",
      p1?.blocked === null &&
        p1.registered === 8 &&
        p1.eligible === 3 &&
        p1.viaText === 2 &&
        p1.viaTemplate === 1 &&
        !p1.template.approved &&
        p1.sendableNow === 2 &&
        reasons.no_consent === 1 &&
        reasons.paid === 1 &&
        reasons.client === 1 &&
        reasons.personal === 1 &&
        reasons.opted_out === 1,
      p1
    );
    check("   la plantilla que falta se manda a aprobar (aquí, de mentira)", ensured.some((k) => k.includes(INVITE_TEMPLATE_KEY)), ensured);
    check("   el ejemplo dice que es de pago y hace la pregunta del cupo", Boolean(p1?.textExample.includes("Es un taller de pago.") && p1.textExample.endsWith(WORKSHOP_CHOICE)), p1?.textExample);

    // 2. Enviar. Helena paga entre la vista previa y el envío.
    const s1 = await startWorkshopInvite({ editionId: edition.id, staffId }, deps);
    check("2. empieza con las 2 que pueden recibirla ahora", s1.status === "started" && s1.total === 2, s1);
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
          msgA.clientKey === `taller-invita:${edition.id}:${a.id}` &&
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
    check("   el envío queda terminado: 1 enviada, 1 no", prog1.status === "DONE" && prog1.sent === 1 && prog1.skipped === 1 && prog1.pending === 0, prog1);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: sendId1, action: "WHATSAPP_BULK_CREATED" } });
    check("   queda en la auditoría", Boolean(audit), audit);

    // 3. Otra vez: a nadie dos veces; sin plantilla aprobada, nada.
    const p2 = await previewWorkshopInvite(edition.id, deps);
    const reasons2 = Object.fromEntries((p2?.excluded ?? []).map((e) => [e.reason, e.count]));
    const s2 = await startWorkshopInvite({ editionId: edition.id, staffId }, deps);
    check(
      "3. otra vez: Rosa ya invitada, Helena ya pagó; Beatriz espera la plantilla, así que no se envía nada",
      reasons2.already_invited === 1 && reasons2.paid === 2 && p2?.eligible === 1 && p2.sendableNow === 0 && s2.status === "blocked" && /plantilla/.test(s2.message),
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
    const p3 = await previewWorkshopInvite(edition.id, deps);
    const s3 = await startWorkshopInvite({ editionId: edition.id, staffId }, deps);
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
    const s4 = await startWorkshopInvite({ editionId: edition.id, staffId }, deps);
    check("5. otra vez: no hay a quién invitar", s4.status === "blocked" && /No hay a quién/.test(s4.message) && sent.length === 2, { s4, sent: sent.length });

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
    check("7. «Que la IA le escriba» el mismo día: ya le escribió", offer.status === "skipped" && offer.reason === "already" && sent.length === 2, offer);

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
    check(
      "   la lista: Rosa y Beatriz invitadas (y respondieron), Helena sin enviar con el motivo",
      list.length === 3 &&
        lA?.status === "SENT" &&
        lA.mode === "text" &&
        lA.answeredAt !== null &&
        lB?.status === "SENT" &&
        lB.mode === "template" &&
        lH?.status === "SKIPPED",
      list
    );
    const kinds = await prisma.whatsAppSend.findMany({ where: { workshopEditionId: edition.id }, select: { kind: true } });
    check("   los envíos quedan en la historia del taller", kinds.length === 2 && kinds.every((k) => k.kind === INVITE_SEND_KIND), kinds);
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
