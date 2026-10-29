/**
 * Registro de interés en el taller desde la página (`workshop-registration.ts`,
 * dueña 28-oct: «la gente que oprime ahí en taller se registra y se clasifica
 * como interesada; una vez clasificada, se le envía un mensaje automático»).
 * Contra la base de DESARROLLO, con talleres y personas de prueba que se
 * borran al final. Envío de mentira: no sale nada a WhatsApp, y la plantilla
 * no se manda a aprobar (no se llama a 360dialog).
 *
 *   bun --env-file=/e/Dev/Dayana/dayana-pnl/.env scripts/workshop-registration-e2e.ts
 *
 * 1. Se registra (escribió hace 1 h): contacto con la etiqueta, el detalle de
 *    origen y su correo, su chat de siempre, la fila en «Interesadas» (marca de
 *    la página) y UN WhatsApp de texto (su nombre, el taller, la pregunta del
 *    cupo o la llamada, sin precio ni enlace) con `source` `asistente:taller:<edición>`.
 * 2. Otra vez: ningún mensaje más y la nota no se repite.
 * 3. Ya pagó la edición: ni fila ni mensaje.
 * 4. Baja / número personal (ignorado) / chat personal / clienta: no sale.
 *    El correo de otra persona no cambia de quién es el registro: el número de
 *    alguien que pidió la baja no recibe nada (y su chat queda con su dueño);
 *    también con el número guardado en la forma vieja de México (+521) y con un
 *    chat ligado a otro contacto del mismo número.
 * 5. Privacidad: un correo de alguien que pagó no le cambia el teléfono ni el
 *    correo, ni se le pega al contacto nuevo; un nombre distinto no renombra a
 *    nadie ni va en el saludo.
 * 6. Fuera de las 24 h sin la plantilla aprobada: «espera la plantilla» y se
 *    pide aprobarla (de mentira). Aprobada como Marketing: no sale. Como
 *    Utilidad: sale. Un número de fuera del público: no sale.
 * 7. Tope de plantillas: queda pendiente, sin sellar; al registrarse otra vez, sale.
 * 8. Por conexión: 2 plantillas al día; la tercera queda pendiente y sale desde otra.
 * 9. Ya le escribimos hoy por este taller: no otra vez.
 * 10. Preguntó antes por WhatsApp («No le interesa»): vuelve a «Nuevo», conserva
 *     su mensaje y recibe el del registro.
 * 11. Un taller que ya empezó: no se puede registrar, no está en el botón, no sale.
 * 12. Su respuesta sigue lo del taller y la fila está en «Interesadas» con el estado.
 * 13. «Que la IA le escriba»: a quien esperaba la plantilla, la del registro; a
 *     quien ya se la llegó (al día siguiente), nunca otra vez la misma.
 */
export {};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  process.env.NOTIFICATIONS_DRY_RUN = "true";
  const { prisma } = await import("@/lib/db");
  const {
    IP_BUDGET_ENTITY,
    loadRegistrationEdition,
    openWorkshopForRegistration,
    registerWorkshopInterest,
    registrationIpKey,
    sendWorkshopRegistrationWhatsApp,
  } = await import("@/lib/crm/workshop-registration");
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
  // Uno que empezó hace una hora (con hora): ya no se registra.
  const started = await prisma.workshopEdition.create({
    data: {
      slug: `e2e-registro-empezo-${run}`,
      title: "Taller que ya empezó",
      status: "OPEN",
      startsAt: ago(1),
      startsAtHasTime: true,
      timezone: "America/Bogota",
    },
  });

  // Números válidos: Colombia +57 31x…, México +52 55… (y su forma vieja +521), Reino Unido +44 7400…
  const co = (n: string) => `+5731${run}${n}`;
  const mx = (n: string) => `+5255${run}${n}`;
  const mxOld = (n: string) => `+52155${run}${n}`;
  const contactIds = new Set<string>();
  const threads: string[] = [];
  const ignored: string[] = [];
  const ips = new Set<string>();
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
  const sentTo = (conv: string | null | undefined) => sent.filter((m) => m.conversationId === conv);

  /** Un contacto (y quizá su chat, en el que escribió hace `hours` horas). */
  const person = async (
    phone: string,
    opts: {
      firstName: string;
      email?: string;
      optedOut?: boolean;
      chat?: { hours: number; category?: string; segment?: string; stage?: string; body?: string; thread?: string };
    }
  ) => {
    const c = await prisma.contact.create({
      data: {
        phoneE164: phone,
        phoneCountryIso: phone.startsWith("+52") ? "MX" : "CO",
        firstName: opts.firstName,
        lastName: "Prueba",
        email: opts.email ?? null,
        source: "WHATSAPP_DIRECT",
        notifyWhatsapp: !opts.optedOut,
      },
    });
    contactIds.add(c.id);
    threads.push(phone.slice(1));
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
          lastInboundAt: ago(opts.chat.hours),
          ...(opts.chat.category ? { category: opts.chat.category, categorySource: "manual" } : {}),
        },
      });
      conversationId = conv.id;
      await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          direction: "INBOUND",
          kind: "message",
          body: opts.chat.body ?? "Hola, vi tu video en TikTok",
          sentAt: ago(opts.chat.hours),
          status: "RECEIVED",
        },
      });
      if (opts.chat.segment) {
        await prisma.whatsAppDossier.create({
          data: { conversationId: conv.id, segment: opts.chat.segment, stage: opts.chat.stage ?? null, segmentSource: "manual" },
        });
      }
    }
    return { contactId: c.id, conversationId, phone };
  };

  const edition = (await loadRegistrationEdition(created.slug))!;
  let ipN = 0;
  /** Registrarse y, como la ruta, mandar el WhatsApp (también en un registro repetido: el reclamo decide). */
  const register = async (
    phone: string,
    firstName: string,
    extra: { email?: string; consentMarketing?: boolean; country?: string; ip?: string; cap?: { perHour: number; perDay: number }; ed?: typeof edition } = {}
  ) => {
    const ip = extra.ip ?? `198.51.100.${++ipN}`;
    ips.add(ip);
    const ed = extra.ed ?? edition;
    const r = await registerWorkshopInterest(ed, {
      firstName,
      lastName: "Prueba",
      email: extra.email ?? null,
      phone,
      phoneCountry: extra.country ?? (phone.startsWith("+52") ? "MX" : phone.startsWith("+44") ? "GB" : "CO"),
      consentMarketing: extra.consentMarketing ?? false,
      ref: "enlaces",
    });
    contactIds.add(r.contactId);
    threads.push(phone.slice(1));
    const s =
      r.status === "registered"
        ? await sendWorkshopRegistrationWhatsApp(
            { editionId: ed.id, interestId: r.interestId, contactId: r.contactId, firstName: r.firstName, ip },
            { ...deps, ...(extra.cap ? { cap: extra.cap } : {}) }
          )
        : null;
    if (r.status === "registered") threads.push((await prisma.conversation.findUnique({ where: { id: r.conversationId } }))!.externalThreadId);
    return { r, s, conv: r.status === "registered" ? r.conversationId : null };
  };
  const rowOf = async (conversationId: string | null, editionId = created.id) =>
    conversationId
      ? ((
          await prisma.$queryRaw<{ id: string; first_message: string; offered_via: string | null; offered_at: Date | null; status: string; asks: number }[]>`
            SELECT id, first_message, offered_via, offered_at, status, asks FROM workshop_interests
            WHERE edition_id = ${editionId} AND conversation_id = ${conversationId}`
        )[0] ?? null)
      : null;
  const stateOf = async (conv: string | null) => (await rowOf(conv))?.offered_via ?? null;

  try {
    check("0. la edición abierta se puede registrar, con su enlace de pago", edition.open && edition.payPath === `/pagar/p/${productId}`, edition);

    // 1. Ana escribió hace 1 h: registro + un mensaje de texto.
    const ana = await person(co("01"), { firstName: "Ana", chat: { hours: 1 } });
    const a1 = await register(co("01"), "Ana", { email: `e2e-registro-${run}@example.com`, consentMarketing: true });
    const rowA = await rowOf(ana.conversationId);
    const contactA = await prisma.contact.findUnique({
      where: { id: ana.contactId },
      select: { consentMarketingAt: true, sourceDetail: true, email: true, notes: true, tags: { select: { tag: { select: { slug: true } } } } },
    });
    const msgA = sentTo(ana.conversationId)[0];
    check(
      "1. se registra: su mismo chat, la fila de la página, etiqueta, detalle de origen, su correo (libre) y su segundo permiso",
      a1.r.status === "registered" &&
        a1.r.conversationId === ana.conversationId &&
        !a1.r.alreadyRegistered &&
        rowA?.first_message === PAGE_REGISTRATION_MESSAGE &&
        Boolean(contactA?.tags.some((t) => t.tag.slug === WORKSHOP_INTEREST_TAG_SLUG)) &&
        contactA?.sourceDetail === "Interés en taller: Tu Sanacion con el Dinero (Enlaces)" &&
        contactA?.email === `e2e-registro-${run}@example.com` &&
        Boolean(contactA?.consentMarketingAt),
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
        msgA?.clientKey === registrationClientKey(edition.id, ana.conversationId!) &&
        !tpl(msgA),
      { s: a1.s, msgA }
    );
    const rowA1 = await rowOf(ana.conversationId);
    check("   la fila queda «pagina:text», con la fecha y en «Contactada»", rowA1?.offered_via === "pagina:text" && Boolean(rowA1.offered_at) && rowA1.status === "contactada", rowA1);

    // 2. Otra vez: el reclamo no deja; la nota no se repite.
    const a2 = await register(co("01"), "Ana");
    const notesA = (await prisma.contact.findUnique({ where: { id: ana.contactId }, select: { notes: true } }))?.notes ?? "";
    check(
      "2. otra vez: «ya registrada» por dentro, ningún WhatsApp más y la nota una sola vez",
      a2.r.status === "registered" &&
        a2.r.alreadyRegistered &&
        a2.s?.status === "skipped" &&
        a2.s.state === "already" &&
        sent.length === 1 &&
        notesA.split("Se registró en la página del taller").length === 2,
      { a2, sent: sent.length, notesA }
    );

    // 3. Beatriz ya pagó esta edición.
    const bea = await person(co("02"), { firstName: "Beatriz", chat: { hours: 1 } });
    await prisma.enrollment.create({ data: { contactId: bea.contactId, productId, workshopEditionId: edition.id, status: "ACTIVE" } });
    const b = await register(co("02"), "Beatriz");
    check("3. ya pagó: ni fila ni WhatsApp", b.r.status === "enrolled" && b.s === null && !(await rowOf(bea.conversationId)) && sentTo(bea.conversationId).length === 0, b);

    // 4. Baja, número ignorado, chat personal, clienta.
    const car = await person(co("03"), { firstName: "Carla", optedOut: true, chat: { hours: 1 } });
    const c = await register(co("03"), "Carla");
    const dia = co("04");
    ignored.push(dia);
    await ignoreNumbers([dia.slice(1)], "manual");
    const d = await register(dia, "Diana");
    const diaChat = await prisma.conversation.findFirst({ where: { channel: "WHATSAPP", externalThreadId: dia.slice(1) } });
    const ele = await person(co("05"), { firstName: "Elena", chat: { hours: 1, category: "personal" } });
    const e = await register(co("05"), "Elena");
    const fab = await person(co("06"), { firstName: "Fabiola", chat: { hours: 1, category: "cliente", segment: "client", stage: "clienta_activa" } });
    const f = await register(co("06"), "Fabiola");
    check(
      "4. pidió la baja / número personal ignorado (ni chat ni fila) / chat personal / clienta: no sale",
      c.s?.status === "skipped" &&
        c.s.state === "baja" &&
        (await stateOf(car.conversationId)) === "pagina:baja" &&
        d.r.status === "personal" &&
        !diaChat &&
        e.s?.status === "skipped" &&
        e.s.state === "personal" &&
        f.s?.status === "skipped" &&
        f.s.state === "clienta" &&
        [car, ele, fab].every((p) => sentTo(p.conversationId).length === 0),
      { c, d, diaChat: diaChat?.id, e, f }
    );

    // El correo de Olga con el número de Berta (que pidió la baja).
    const olga = await person(co("40"), { firstName: "Olga", email: `olga-${run}@example.com` });
    const berta = await person(co("41"), { firstName: "Berta", optedOut: true });
    const o = await register(co("41"), "Olga", { email: `olga-${run}@example.com` });
    const olgaNow = await prisma.contact.findUnique({ where: { id: olga.contactId }, select: { phoneE164: true, email: true } });
    const bertaNow = await prisma.contact.findUnique({ where: { id: berta.contactId }, select: { email: true, firstName: true } });
    const oChat = o.conv ? await prisma.conversation.findUnique({ where: { id: o.conv }, select: { contactId: true } }) : null;
    check(
      "   el correo de otra (Olga) con el número de quien pidió la baja (Berta): el registro es de Berta, su chat queda con ella y no sale nada",
      o.r.status === "registered" &&
        o.r.contactId === berta.contactId &&
        oChat?.contactId === berta.contactId &&
        o.s?.status === "skipped" &&
        o.s.state === "baja" &&
        olgaNow?.phoneE164 === co("40") &&
        olgaNow?.email === `olga-${run}@example.com` &&
        bertaNow?.email === null &&
        bertaNow?.firstName === "Berta" &&
        sentTo(o.conv).length === 0,
      { o, olgaNow, bertaNow, oChat }
    );
    // México: el número guardado en la forma vieja (+521) pidió la baja.
    const mia = await person(mxOld("66"), { firstName: "Mía", optedOut: true });
    const mi = await register(mx("66"), "Mía");
    check(
      "   México: con el número guardado como +521 (pidió la baja), el registro es de ese contacto y no sale nada",
      mi.r.status === "registered" && mi.r.contactId === mia.contactId && mi.s?.status === "skipped" && mi.s.state === "baja" && sentTo(mi.conv).length === 0,
      mi
    );
    // Un chat ligado a otro contacto del mismo número: la baja del otro cuenta.
    await person(mx("77"), { firstName: "Xenia", chat: { hours: 1, thread: mxOld("77").slice(1) } });
    await person(mxOld("77"), { firstName: "Ximena", optedOut: true });
    const x = await register(mx("77"), "Xenia");
    check(
      "   al enviar se miran TODOS los contactos de ese número: la baja de otro contacto (forma vieja) no deja salir nada",
      x.r.status === "registered" && x.s?.status === "skipped" && x.s.state === "baja" && sentTo(x.conv).length === 0,
      x
    );

    // 5. Privacidad: el correo de quien pagó (Paula) con otro número.
    const paula = await person(co("50"), { firstName: "Paula", email: `paula-${run}@example.com` });
    await prisma.enrollment.create({ data: { contactId: paula.contactId, productId, workshopEditionId: edition.id, status: "ACTIVE" } });
    const q = await register(co("51"), "Quien", { email: `paula-${run}@example.com` });
    const paulaNow = await prisma.contact.findUnique({ where: { id: paula.contactId }, select: { phoneE164: true, email: true, firstName: true } });
    const qContact = await prisma.contact.findUnique({ where: { id: q.r.contactId }, select: { email: true, phoneE164: true } });
    const p2 = await register(co("50"), "Intrusa");
    const paulaAfter = await prisma.contact.findUnique({ where: { id: paula.contactId }, select: { firstName: true } });
    check(
      "5. el correo de alguien que pagó no le cambia el teléfono ni el correo, ni se pega al contacto nuevo; su número da «ya pagó» por dentro y su nombre no cambia",
      q.r.status === "registered" &&
        q.r.contactId !== paula.contactId &&
        paulaNow?.phoneE164 === co("50") &&
        paulaNow?.email === `paula-${run}@example.com` &&
        qContact?.email === null &&
        qContact?.phoneE164 === co("51") &&
        p2.r.status === "enrolled" &&
        paulaAfter?.firstName === "Paula",
      { q, paulaNow, qContact, p2 }
    );

    // 6. Gloria nunca escribió: fuera de las 24 h, sin la plantilla aprobada.
    const g = await register(co("07"), "Gloria");
    check(
      "6. fuera de las 24 h sin la plantilla: «espera la plantilla», su chat se crea, se pide aprobarla",
      g.s?.status === "skipped" &&
        g.s.state === "plantilla" &&
        Boolean(g.conv) &&
        (await stateOf(g.conv)) === "pagina:plantilla" &&
        submitted.length >= 1 &&
        submitted.every((k) => k[0] === REGISTRATION_TEMPLATE_KEY) &&
        sentTo(g.conv).length === 0,
      { g, submitted }
    );
    // Aprobada como Marketing (Meta la recategorizó): no sale sola.
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
    const m = await register(co("08"), "Marta");
    check(
      "   aprobada como Marketing: no se envía sola; queda «pagina:marketing»",
      m.s?.status === "skipped" && m.s.state === "marketing" && (await stateOf(m.conv)) === "pagina:marketing" && sentTo(m.conv).length === 0,
      m
    );
    await prisma.messageTemplate.update({ where: { id: tmpTemplate.id }, data: { metaCategory: "UTILITY" } });
    const h = await register(co("09"), "Helena", { ip: "203.0.113.10" });
    const msgH = sentTo(h.conv)[0];
    check(
      "   aprobada como Utilidad: sale con ella (nombre, taller), la pregunta del cupo y su source",
      h.s?.status === "sent" &&
        h.s.via === "template" &&
        tpl(msgH)?.name === REGISTRATION_TEMPLATE_KEY &&
        JSON.stringify(tpl(msgH)?.variables).includes("Helena") &&
        JSON.stringify(tpl(msgH)?.variables).includes("«Tu Sanacion con el Dinero»") &&
        Boolean(msgH?.body.includes("¿Prefieres el enlace para separar tu cupo o agendar la llamada?")) &&
        msgH?.source === workshopOutreachSource(edition) &&
        (await stateOf(h.conv)) === "pagina:template",
      { h, msgH }
    );
    const gb = await register(`+447400${run}`, "Greg");
    check("   un número de fuera del público (Reino Unido): no sale la plantilla sola", gb.s?.status === "skipped" && gb.s.state === "pais" && sentTo(gb.conv).length === 0, gb);

    // 7. Tope de plantillas: con un tope de 1 por hora (ya salió la de Helena), Isabel queda pendiente.
    const i1 = await register(co("10"), "Isabel", { cap: { perHour: 1, perDay: 100 } });
    const i2 = await register(co("10"), "Isabel");
    check(
      "7. pasado el tope: pendiente («pagina:tope», sin sellar); al registrarse otra vez (con cupo), sale",
      i1.s?.status === "skipped" && i1.s.state === "tope" && i2.r.status === "registered" && i2.s?.status === "sent" && sentTo(i1.conv).length === 1,
      { i1: i1.s, i2: i2.s }
    );

    // 8. Por conexión: dos plantillas al día desde la misma IP; la tercera, pendiente.
    const shared = "203.0.113.50";
    const l = await register(co("20"), "Lucía", { ip: shared });
    const mo = await register(co("21"), "Mónica", { ip: shared });
    const n1 = await register(co("22"), "Nora", { ip: shared });
    const reserved = await prisma.auditLog.count({ where: { entityType: IP_BUDGET_ENTITY, entityId: registrationIpKey(shared) } });
    const n2 = await register(co("22"), "Nora", { ip: "203.0.113.51" });
    check(
      "8. por conexión: 2 plantillas al día; la 3.ª queda «pagina:ip» (sin sellar) y sale al registrarse desde otra conexión",
      l.s?.status === "sent" &&
        mo.s?.status === "sent" &&
        n1.s?.status === "skipped" &&
        n1.s.state === "ip" &&
        reserved === 2 &&
        n2.s?.status === "sent" &&
        sentTo(n1.conv).length === 1,
      { l: l.s, mo: mo.s, n1: n1.s, reserved, n2: n2.s }
    );

    // 9. A Karen la IA ya le escribió hoy por este taller; se registra con otro nombre.
    const kar = await person(co("11"), { firstName: "Karen", chat: { hours: 1 } });
    await prisma.conversationMessage.create({
      data: {
        conversationId: kar.conversationId!,
        direction: "OUTBOUND",
        kind: "message",
        body: "Sobre el taller…",
        source: workshopOutreachSource(edition),
        isAutoReply: true,
        status: "SENT",
        sentAt: ago(2),
      },
    });
    const k = await register(co("11"), "Otra Persona");
    const karNow = await prisma.contact.findUnique({ where: { id: kar.contactId }, select: { firstName: true } });
    check(
      "9. ya le escribimos hoy por este taller: no otra vez; el nombre escrito no la renombra ni va en el saludo",
      k.s?.status === "skipped" && k.s.state === "ya_escrito" && sentTo(kar.conversationId).length === 0 && karNow?.firstName === "Karen" && k.r.status === "registered" && k.r.firstName === null,
      { k, karNow }
    );

    // 10. Julia preguntó por WhatsApp hace días y Dayana la marcó «No le interesa».
    const jul = await person(co("12"), { firstName: "Julia", chat: { hours: 2, body: "¿Cuánto cuesta el taller de la sanación con el dinero?" } });
    await prisma.$executeRaw`
      INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, updated_at)
      VALUES (${`e2e-${run}-jul`}, ${edition.id}, ${jul.conversationId}, ${"¿Cuánto cuesta el taller de la sanación con el dinero?"}, ${ago(50)}, ${ago(50)}, 1, 'descartada', NOW())`;
    const j = await register(co("12"), "Julia");
    const rowJ = await rowOf(jul.conversationId);
    check(
      "10. ya estaba en «Interesadas» por WhatsApp: conserva su mensaje, vuelve a «Nuevo» → «Contactada» y recibe el WhatsApp con su nombre",
      j.r.status === "registered" &&
        !j.r.alreadyRegistered &&
        rowJ?.first_message.startsWith("¿Cuánto cuesta") === true &&
        rowJ.asks === 2 &&
        rowJ.status === "contactada" &&
        rowJ.offered_via === "pagina:text" &&
        Boolean(sentTo(jul.conversationId)[0]?.body.startsWith("Hola Julia 🙏")),
      { j, rowJ }
    );

    // 11. El taller que ya empezó.
    const startedEd = (await loadRegistrationEdition(started.slug))!;
    const forButton = await openWorkshopForRegistration();
    await prisma.$executeRaw`
      INSERT INTO workshop_interests (id, edition_id, conversation_id, first_message, first_asked_at, last_asked_at, asks, status, updated_at)
      VALUES (${`e2e-${run}-empezo`}, ${started.id}, ${ana.conversationId}, ${PAGE_REGISTRATION_MESSAGE}, NOW(), NOW(), 1, 'nuevo', NOW())`;
    const late = await sendWorkshopRegistrationWhatsApp(
      { editionId: started.id, interestId: `e2e-${run}-empezo`, contactId: ana.contactId, firstName: "Ana", ip: "198.51.100.200" },
      deps
    );
    check(
      "11. un taller que empezó hace una hora: la página no lo abre, el botón no lo muestra y no sale nada («cerrado»)",
      !startedEd.open && forButton?.slug !== started.slug && late.status === "skipped" && late.state === "cerrado" && sentTo(ana.conversationId).length === 1,
      { open: startedEd.open, forButton, late }
    );

    // 12. Ana contesta «Quiero separar mi cupo»: sigue lo del taller; en «Interesadas» con su estado.
    await prisma.conversationMessage.create({
      data: { conversationId: ana.conversationId!, direction: "INBOUND", kind: "message", body: "Quiero separar mi cupo", status: "RECEIVED" },
    });
    await prisma.conversation.update({ where: { id: ana.conversationId! }, data: { lastInboundAt: new Date() } });
    const lines = await prisma.conversationMessage.findMany({
      where: { conversationId: ana.conversationId! },
      orderBy: { sentAt: "asc" },
      select: { direction: true, body: true, sentAt: true, source: true },
    });
    check(
      "12. su respuesta es del taller (workshopLeadActive), es elegir el cupo y la IA sigue la pregunta del cupo o la llamada",
      workshopLeadActive(lines, edition) &&
        wantsWorkshopSpot("Quiero separar mi cupo", { afterChoice: true }) &&
        workshopFollowLine(lines, edition).includes("le preguntamos si quiere separar su cupo"),
      lines.map((x) => [x.direction, x.source, x.body?.slice(0, 40)])
    );
    const list = await listWorkshopInterests(edition.id);
    const by = (conv: string | null) => list.find((r) => r.conversationId === conv);
    check(
      "   «Interesadas»: Ana «WhatsApp enviado»; Gloria espera la plantilla; Marta, Marketing; Carla, baja; Greg, país; Helena por plantilla; Julia con su mensaje; Beatriz no",
      by(ana.conversationId)?.registration?.label === "WhatsApp enviado" &&
        by(ana.conversationId)?.pageOnly === true &&
        by(g.conv)?.registration?.label === "WhatsApp: espera la plantilla" &&
        by(m.conv)?.registration?.label === "WhatsApp: Meta pasó la plantilla a Marketing" &&
        by(car.conversationId)?.registration?.detail === "Pidió no recibir WhatsApp." &&
        Boolean(by(gb.conv)?.registration?.detail?.includes("fuera del público")) &&
        by(h.conv)?.registration?.label === "WhatsApp enviado (plantilla)" &&
        by(jul.conversationId)?.pageOnly === false &&
        by(jul.conversationId)?.registration?.kind === "sent" &&
        !by(bea.conversationId),
      list.map((r) => ({ name: r.name, registration: r.registration, pageOnly: r.pageOnly }))
    );

    // 13. «Que la IA le escriba» a Gloria (esperaba la plantilla, ahora aprobada como Utilidad).
    const gRow = await rowOf(g.conv);
    const before = sent.length;
    const offer = await offerWorkshopCall({ editionId: edition.id, interestId: gRow!.id }, { send: fakeSend });
    const msgG = sent.slice(before).find((x) => x.conversationId === g.conv);
    check(
      "13. «Que la IA le escriba» a quien se registró y nunca escribió: la plantilla del registro, y conserva la marca de la página",
      offer.status === "sent" && offer.via === "template" && tpl(msgG)?.name === REGISTRATION_TEMPLATE_KEY && (await stateOf(g.conv)) === "pagina:template",
      { offer, msgG }
    );
    // Al día siguiente (la clave es por día): ya le llegó, así que no la misma plantilla otra vez.
    const tomorrow = new Date(Date.now() + 26 * 3600_000);
    const before2 = sent.length;
    const offer2 = await offerWorkshopCall({ editionId: edition.id, interestId: gRow!.id }, { send: fakeSend, now: tomorrow });
    const hRow = await rowOf(h.conv);
    const offerH = await offerWorkshopCall({ editionId: edition.id, interestId: hRow!.id }, { send: fakeSend, now: tomorrow });
    const again = sent.slice(before2).filter((x) => tpl(x)?.name === REGISTRATION_TEMPLATE_KEY);
    check(
      "   al día siguiente, a quien ya le llegó «Recibimos tu registro» (por el registro o por «Que la IA le escriba»): nunca otra vez esa plantilla (va la de siempre; en desarrollo no está aprobada)",
      again.length === 0 && offer2.status === "skipped" && offer2.reason === "needs_template" && offerH.status === "skipped" && offerH.reason === "needs_template",
      { offer2, offerH, again: again.length }
    );
  } finally {
    for (const id of [created.id, started.id]) {
      await prisma.$executeRaw`DELETE FROM workshop_interests WHERE edition_id = ${id}`;
      await prisma.auditLog.deleteMany({ where: { entityType: IP_BUDGET_ENTITY, changes: { path: ["editionId"], equals: id } } });
    }
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
    await prisma.workshopEdition.deleteMany({ where: { id: { in: [created.id, started.id] } } });
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
