/**
 * Recordatorios del evento gratuito por WhatsApp, la separación de una edición
 * pasada mezclada en la viva y el reloj de eventos. Contra la base de
 * DESARROLLO y con WhatsApp en modo prueba (no sale nada de verdad).
 *
 *   bun scripts/whatsapp-event-reminders-e2e.ts   (también en `bun run e2e:whatsapp`)
 *
 * No toca la edición viva («gratuito») salvo en la prueba del reloj, y allí la
 * deja como estaba.
 */
import { POST as cronEventos } from "@/app/api/cron/eventos/route";
import { prisma } from "@/lib/db";
import {
  EVENT_WA_REMINDERS_SETTING,
  EVENT_WA_TEMPLATE_KEY,
  sendEventWhatsAppReminders,
} from "@/lib/crm/event-whatsapp-reminders";
import {
  applyFreeEventSplit,
  planFreeEventSplit,
  rollbackFreeEventSplit,
  splitBackupOf,
  type SplitBackup,
} from "@/lib/crm/free-event-split";
import { FREE_WEBINAR_SLUG } from "@/lib/crm/free-webinar";
import { getSiteSetting, setSiteSetting, deleteSiteSetting } from "@/lib/crm/site-settings";
import { resetReminders, webinarRegistrationStats } from "@/lib/crm/webinar-registrations";
import { planForRecipient, recipientFromContact } from "@/lib/crm/whatsapp-outbound";
import { approvedTemplateFor } from "@/lib/crm/whatsapp-templates";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { resolveDryRun } from "@/lib/notifications/platform/resolve";
import { whatsAppDigits } from "@/lib/whatsapp-contact";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const t0 = new Date();
const H = 3600_000;
const MEET = "https://meet.google.com/e2e-wa-test";

const PHONES = {
  open: "+573000007701", // escribió hace 1 h → texto libre
  never: "+573000007702", // nunca escribió → plantilla
  optout: "+573000007703", // pidió no recibir WhatsApp → no entra
  mx: "+525500007704", // México → su hora en el mensaje
  pend: "+573000007705", // para el fallo sin plantilla y el reintento
} as const;
const SPLIT_PHONES = ["+573000007711", "+573000007712", "+573000007713", "+573000007714", "+573000007715"];
const ALL_PHONES = [...Object.values(PHONES), ...SPLIT_PHONES];
const threads = ALL_PHONES.map((p) => whatsAppDigits(p));

const NAMES: Record<keyof typeof PHONES, string> = {
  open: "Abierta",
  never: "Nunca",
  optout: "Baja",
  mx: "Mexicana",
  pend: "Pendiente",
};

const PROD_TEMPLATE = {
  title: "Evento gratuito: recordatorio",
  body: "Hola {{nombre}}, te recuerdo que {{evento}} es el {{fecha}}. Entra aquí: {{enlace}} Nos vemos pronto 💛",
  metaTemplateName: "evento_gratis_recordatorio",
  metaTemplateLang: "es",
  metaCategory: "MARKETING",
  metaBody: "Hola {{1}}, te recuerdo que {{2}} es el {{3}}. Entra aquí: {{4}} Nos vemos pronto 💛",
  metaVarNames: ["nombre", "evento", "fecha", "enlace"],
};

const setTemplateStatus = (status: string) =>
  prisma.messageTemplate.upsert({
    where: { key_locale: { key: EVENT_WA_TEMPLATE_KEY, locale: "es" } },
    create: { key: EVENT_WA_TEMPLATE_KEY, locale: "es", ...PROD_TEMPLATE, metaApprovalStatus: status },
    update: { ...PROD_TEMPLATE, metaApprovalStatus: status },
  });

const contactIds: Record<string, string> = {};
const webinarIds: string[] = [];

const cleanup = async () => {
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } } });
  await prisma.platformNotification.deleteMany({
    where: {
      OR: [
        { entityType: "FreeWebinar", entityId: { in: webinarIds } },
        { entityType: "Contact", entityId: { in: Object.values(contactIds) }, createdAt: { gte: new Date("2026-01-01") } },
      ],
    },
  });
  await prisma.freeWebinar.deleteMany({ where: { id: { in: webinarIds } } });
  await prisma.freeWebinar.deleteMany({ where: { slug: { startsWith: `e2e-split-${run}` } } });
  await prisma.contact.deleteMany({ where: { phoneE164: { in: ALL_PHONES } } }).catch(() => undefined);
};

const upsertContact = async (phone: string, firstName: string, extra: { notifyWhatsapp?: boolean } = {}) => {
  const c = await prisma.contact.upsert({
    where: { phoneE164: phone },
    create: { phoneE164: phone, firstName, lastName: `Prueba${run}`, notifyWhatsapp: extra.notifyWhatsapp ?? true },
    update: {
      firstName,
      lastName: `Prueba${run}`,
      notifyWhatsapp: extra.notifyWhatsapp ?? true,
      timezone: "America/Bogota",
      phoneCountryIso: null,
    },
    select: { id: true },
  });
  contactIds[phone] = c.id;
  return c.id;
};

const remindersPart = async () => {
  console.log("\n1. Preparar: evento de prueba, cuatro personas, plantilla aprobada");
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  check("WhatsApp en modo prueba", await resolveDryRun());
  if (!(await resolveDryRun())) throw new Error("El modo prueba no está activo: no sigo.");

  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } } });
  for (const key of Object.keys(PHONES) as (keyof typeof PHONES)[]) {
    await upsertContact(PHONES[key], NAMES[key], { notifyWhatsapp: key !== "optout" });
  }
  await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: whatsAppDigits(PHONES.open),
      metaAccountId: "test-phone-id",
      participantName: "Abierta",
      contactId: contactIds[PHONES.open],
      lastInboundAt: new Date(Date.now() - H),
      lastMessageAt: new Date(),
    },
  });
  await setTemplateStatus("APPROVED");

  const startsAt = new Date(Math.floor((Date.now() + 20 * H) / 60_000) * 60_000);
  const w = await prisma.freeWebinar.create({
    data: {
      slug: `e2e-wa-${run}`,
      isActive: true,
      headline: "Prueba de recordatorios",
      startsAt,
      startsAtHasTime: true,
      meetUrl: MEET,
      learnItems: [],
    },
  });
  webinarIds.push(w.id);
  for (const key of ["open", "never", "optout", "mx"] as const) {
    await prisma.webinarRegistration.create({ data: { webinarId: w.id, contactId: contactIds[PHONES[key]] } });
  }

  const tpl = await approvedTemplateFor(EVENT_WA_TEMPLATE_KEY);
  const planOf = async (phone: string) => planForRecipient((await recipientFromContact(contactIds[phone]))!, tpl);
  check("quien escribió hace 1 h va como texto libre", (await planOf(PHONES.open)).action === "text");
  check("quien nunca escribió va con la plantilla", (await planOf(PHONES.never)).action === "template");
  check("+52 que nunca escribió: plantilla", (await planOf(PHONES.mx)).action === "template");

  console.log("\n2. Recordatorio de 24 h");
  const r1 = await sendEventWhatsAppReminders({ pass: "24h", webinarId: w.id });
  check("salen 3 (la que se dio de baja no)", r1.sent === 3 && r1.failed === 0 && r1.skipped === 0 && r1.remaining === 0, r1);
  const r2 = await sendEventWhatsAppReminders({ pass: "24h", webinarId: w.id });
  check("una segunda pasada no manda nada", r2.sent === 0 && r2.failed === 0 && r2.skipped === 0, r2);

  const msgs24 = await prisma.conversationMessage.findMany({
    where: { source: `evento:${w.id}:24h` },
    select: { body: true, isAutoReply: true, conversation: { select: { externalThreadId: true } } },
  });
  const bodyOf = (msgs: typeof msgs24, phone: string) =>
    msgs.find((m) => m.conversation.externalThreadId === whatsAppDigits(phone))?.body ?? "";
  check("3 mensajes en los chats", msgs24.length === 3, msgs24.length);
  check("marcados como automáticos (la IA no los toma por Dayana)", msgs24.every((m) => m.isAutoReply));
  check(
    "todos llevan el enlace de Meet y «hora de Colombia»",
    msgs24.every((m) => m.body?.includes(MEET) && m.body.includes("hora de Colombia")),
    msgs24.map((m) => m.body)
  );
  const openBody = bodyOf(msgs24, PHONES.open);
  check(
    "texto: «Hola Abierta, te recuerdo que «…» es el <día>…»",
    /^Hola Abierta, te recuerdo que «Prueba de recordatorios» es el (lunes|martes|miércoles|jueves|viernes|sábado|domingo) /.test(
      openBody
    ),
    openBody
  );
  check("plantilla: saluda por el nombre", bodyOf(msgs24, PHONES.never).startsWith("Hola Nunca, te recuerdo que"), bodyOf(msgs24, PHONES.never));
  const mxBody = bodyOf(msgs24, PHONES.mx);
  check("+52: también su hora, «en México»", mxBody.includes("en México") && mxBody.includes("hora de Colombia"), mxBody);
  check("Colombia: no repite la hora local", !/[ap]\. m\. en /.test(openBody), openBody);
  check("sin saltos de línea", msgs24.every((m) => !/[\r\n]/.test(m.body ?? "")));
  const optoutReg = await prisma.webinarRegistration.findFirstOrThrow({
    where: { webinarId: w.id, contactId: contactIds[PHONES.optout] },
  });
  check("la de baja ni se sella ni recibe nada", optoutReg.reminder24hWaSentAt === null && !bodyOf(msgs24, PHONES.optout));

  console.log("\n3. Ventana, interruptor y recordatorio de 1 h");
  const early = await sendEventWhatsAppReminders({ pass: "1h", webinarId: w.id });
  check("el de 1 h no sale 20 h antes", early.reason === "outside_window" && early.sent === 0 && early.remaining === 3, early);
  const in1h = new Date(startsAt.getTime() - 30 * 60_000);
  const prevSwitch = await getSiteSetting(EVENT_WA_REMINDERS_SETTING);
  await setSiteSetting(EVENT_WA_REMINDERS_SETTING, "false");
  const off = await sendEventWhatsAppReminders({ pass: "1h", webinarId: w.id, now: in1h });
  check("apagado: no sale nada", off.reason === "disabled" && off.sent === 0, off);
  await setSiteSetting(EVENT_WA_REMINDERS_SETTING, "true");
  const h1 = await sendEventWhatsAppReminders({ pass: "1h", webinarId: w.id, now: in1h });
  check("30 min antes: salen 3", h1.sent === 3 && h1.failed === 0 && h1.skipped === 0, h1);
  const h1b = await sendEventWhatsAppReminders({ pass: "1h", webinarId: w.id, now: in1h });
  check("una segunda pasada no manda nada", h1b.sent === 0, h1b);
  const msgs1h = await prisma.conversationMessage.findMany({
    where: { source: `evento:${w.id}:1h` },
    select: { body: true, isAutoReply: true, conversation: { select: { externalThreadId: true } } },
  });
  check("los de 1 h dicen «(en 1 hora)» y llevan el enlace", msgs1h.length === 3 && msgs1h.every((m) => m.body?.includes("(en 1 hora)") && m.body.includes(MEET)), msgs1h.map((m) => m.body));

  console.log("\n4. Sin plantilla aprobada: queda el motivo y no se reintenta sola; «Reintentar WA» sí");
  await prisma.webinarRegistration.create({ data: { webinarId: w.id, contactId: contactIds[PHONES.pend] } });
  await setTemplateStatus("PENDING");
  const sk = await sendEventWhatsAppReminders({ pass: "24h", webinarId: w.id });
  check("1 sin enviar (nunca escribió y la plantilla no está aprobada)", sk.skipped === 1 && sk.sent === 0, sk);
  const pendReg = await prisma.webinarRegistration.findFirstOrThrow({
    where: { webinarId: w.id, contactId: contactIds[PHONES.pend] },
  });
  check(
    "queda sellada con el motivo en español",
    pendReg.reminder24hWaSentAt !== null && Boolean(pendReg.waReminderError?.includes("plantilla")),
    pendReg.waReminderError
  );
  const sk2 = await sendEventWhatsAppReminders({ pass: "24h", webinarId: w.id });
  check("el reloj no la reintenta (una plantilla se cobra)", sk2.sent + sk2.skipped + sk2.failed === 0, sk2);
  const bell = await prisma.platformNotification.count({
    where: { eventType: "WHATSAPP_AI_INFO", entityType: "FreeWebinar", entityId: w.id },
  });
  check("un aviso en la campana", bell === 1, bell);
  await setTemplateStatus("APPROVED");
  // Lo mismo que hace el botón «Reintentar WA» (scope "one").
  await prisma.webinarRegistration.update({
    where: { id: pendReg.id },
    data: { reminder24hWaSentAt: null, waReminderError: null, waReminderErrorAt: null },
  });
  const retry = await sendEventWhatsAppReminders({
    pass: "24h",
    webinarId: w.id,
    registrationId: pendReg.id,
    ignoreWindow: true,
  });
  const pendAfter = await prisma.webinarRegistration.findUniqueOrThrow({ where: { id: pendReg.id } });
  check("reintento: sale y se limpia el motivo", retry.sent === 1 && pendAfter.waReminderError === null && pendAfter.reminder24hWaSentAt !== null, retry);

  console.log("\n5. Contadores del panel y reprogramación");
  const stats = await webinarRegistrationStats(w.id);
  check(
    "WhatsApp 24 h = 4, 1 h = 3, sin enviar = 0, sin WhatsApp = 1",
    stats.wa24h === 4 && stats.wa1h === 3 && stats.waFailed === 0 && stats.noWhatsApp === 1,
    stats
  );
  await resetReminders(w.id);
  const after = await webinarRegistrationStats(w.id);
  check("cambiar la fecha devuelve también los de WhatsApp a la cola", after.wa24h === 0 && after.wa1h === 0, after);

  if (prevSwitch === null) await deleteSiteSetting(EVENT_WA_REMINDERS_SETTING);
  else await setSiteSetting(EVENT_WA_REMINDERS_SETTING, prevSwitch);
};

const splitPart = async () => {
  console.log("\n6. Separar la edición pasada de la viva");
  const liveSlug = `e2e-split-${run}`;
  const pastStartsAt = new Date("2026-08-16T14:30:00Z");
  const cutoff = new Date("2026-08-17T00:00:00Z");
  const pastMeetUrl = "https://meet.google.com/fyt-axhy-jay";
  const live = await prisma.freeWebinar.create({
    data: {
      slug: liveSlug,
      isActive: true,
      headline: "Evento vivo de prueba",
      startsAt: new Date("2026-10-04T14:30:00Z"),
      startsAtHasTime: true,
      meetUrl: "https://meet.google.com/oct-live-xyz",
      learnItems: ["uno"],
    },
  });
  webinarIds.push(live.id);
  const ids: string[] = [];
  for (const [i, phone] of SPLIT_PHONES.entries()) ids.push(await upsertContact(phone, `Split${i + 1}`));
  const reg = (i: number, createdAt: string, extra: Record<string, Date> = {}) =>
    prisma.webinarRegistration.create({
      data: { webinarId: live.id, contactId: ids[i], createdAt: new Date(createdAt), ...extra },
    });
  const a1 = await reg(0, "2026-08-06T12:00:00Z");
  const a2 = await reg(1, "2026-08-10T12:00:00Z", { linkEmailSentAt: new Date("2026-08-12T10:00:00Z") });
  const a3 = await reg(2, "2026-08-14T12:00:00Z", { reminder24hSentAt: new Date("2026-08-15T14:30:00Z") });
  await reg(3, "2026-09-24T12:00:00Z");
  await reg(4, "2026-09-28T12:00:00Z");
  const reAt = new Date("2026-09-25T15:00:00Z");
  const note = (contactId: string, createdAt: Date) =>
    prisma.platformNotification.create({
      data: {
        eventType: "WEB_LEAD_SUBMITTED",
        title: "Re-registro webinar (prueba)",
        entityType: "Contact",
        entityId: contactId,
        metadata: { webinar: true, alreadyRegistered: true },
        createdAt,
      },
    });
  await note(ids[2], reAt); // se volvió a inscribir
  await note(ids[2], new Date("2026-09-27T15:00:00Z")); // dos veces: cuenta la primera
  await note(ids[0], new Date("2026-08-06T12:00:00Z")); // antes del corte: no cuenta
  await note(ids[3], new Date("2026-09-24T12:00:00Z")); // nueva en septiembre: no es «repite»

  const params = { liveSlug, pastStartsAt, pastMeetUrl, cutoff };
  const plan = await planFreeEventSplit(params);
  check(
    "plan: 2 pasan a la pasada, 1 repite, quedan 3 en la viva",
    plan.toMove.length === 2 && plan.reRegistrants.length === 1 && plan.stayOnLive === 3 && !plan.past.exists,
    { toMove: plan.toMove.length, re: plan.reRegistrants.length, stay: plan.stayOnLive }
  );
  check(
    "quien repite: su fecha nueva es la de su primer re-registro",
    plan.reRegistrants[0]?.contactId === ids[2] && plan.reRegistrants[0].reRegisteredAt.getTime() === reAt.getTime(),
    plan.reRegistrants[0]
  );
  check("simular no escribe nada", (await prisma.freeWebinar.count({ where: { slug: { startsWith: `${liveSlug}-` } } })) === 0);

  const applied = await applyFreeEventSplit(plan);
  check(
    "aplicado: pasada nueva, 2 movidas, 1 copia, 1 fecha nueva, 1 sello viejo quitado",
    applied.createdPast && applied.moved === 2 && applied.copied === 1 && applied.liveRedated === 1 && applied.stampsCleared === 1,
    applied
  );
  const past = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: applied.pastId } });
  webinarIds.push(past.id);
  check(
    "la pasada: archivada, terminada, con su fecha y su Meet",
    past.slug === `${liveSlug}-${past.id}` &&
      !past.isActive &&
      past.endedAt !== null &&
      past.archivedAt !== null &&
      past.startsAt?.getTime() === pastStartsAt.getTime() &&
      past.meetUrl === pastMeetUrl &&
      past.headline === live.headline &&
      past.muxUploadId === null,
    past
  );
  const pastRegs = await prisma.webinarRegistration.findMany({ where: { webinarId: past.id } });
  const sealed = (r: (typeof pastRegs)[number]) =>
    [r.linkEmailSentAt, r.reminder24hSentAt, r.reminder1hSentAt, r.reminder24hWaSentAt, r.reminder1hWaSentAt].every(Boolean);
  check("en la pasada: 3, todas selladas (no les sale nada más)", pastRegs.length === 3 && pastRegs.every(sealed), pastRegs.length);
  const movedA2 = pastRegs.find((r) => r.id === a2.id);
  check("el sello que ya existía se conserva", movedA2?.linkEmailSentAt?.toISOString() === "2026-08-12T10:00:00.000Z", movedA2?.linkEmailSentAt);
  const copy = pastRegs.find((r) => r.contactId === ids[2]);
  check("la copia de quien repite lleva su fecha de agosto", copy?.createdAt.toISOString() === "2026-08-14T12:00:00.000Z", copy?.createdAt);
  const liveRegs = await prisma.webinarRegistration.findMany({ where: { webinarId: live.id } });
  const a3Live = liveRegs.find((r) => r.id === a3.id);
  check(
    "en la viva: 3; quien repite con fecha de septiembre y sin el sello de agosto",
    liveRegs.length === 3 && a3Live?.createdAt.getTime() === reAt.getTime() && a3Live.reminder24hSentAt === null,
    a3Live
  );

  const plan2 = await planFreeEventSplit(params);
  const applied2 = await applyFreeEventSplit(plan2);
  check(
    "una segunda pasada no cambia nada",
    plan2.toMove.length === 0 &&
      plan2.reRegistrants.length === 0 &&
      plan2.past.id === past.id &&
      !applied2.createdPast &&
      applied2.moved + applied2.copied + applied2.liveRedated + applied2.stampsCleared === 0,
    { plan2: { toMove: plan2.toMove.length, re: plan2.reRegistrants.length }, applied2 }
  );

  const backup = JSON.parse(JSON.stringify(splitBackupOf(plan, applied))) as SplitBackup;
  const rb = await rollbackFreeEventSplit(backup);
  const liveBack = await prisma.webinarRegistration.findMany({ where: { webinarId: live.id } });
  const a3Back = liveBack.find((r) => r.id === a3.id);
  check(
    "deshacer: las 5 vuelven a la viva como estaban y la pasada desaparece",
    rb.restored === 3 &&
      rb.copiesDeleted === 1 &&
      rb.pastDeleted &&
      liveBack.length === 5 &&
      a3Back?.createdAt.toISOString() === "2026-08-14T12:00:00.000Z" &&
      a3Back.reminder24hSentAt?.toISOString() === "2026-08-15T14:30:00.000Z" &&
      liveBack.find((r) => r.id === a1.id)?.linkEmailSentAt === null &&
      (await prisma.freeWebinar.count({ where: { id: past.id } })) === 0,
    rb
  );
};

const cronPart = async () => {
  console.log("\n7. Reloj de eventos");
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = `e2e-cron-${run}`;
  const call = (auth?: string) =>
    cronEventos(
      new Request("http://localhost/api/cron/eventos", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      })
    );
  check("sin secreto: 401", (await call()).status === 401);
  check("con un secreto equivocado: 401", (await call("Bearer otro-secreto")).status === 401);

  // El reloj trabaja sobre la edición viva compartida de desarrollo: se
  // guarda su estado y se deja igual al terminar.
  const live = await prisma.freeWebinar.findUnique({ where: { slug: FREE_WEBINAR_SLUG } });
  const res = await call(`Bearer ${process.env.CRON_SECRET}`);
  const json = (await res.json()) as { ok: boolean; steps: { name: string; ok: boolean }[] };
  check("con el secreto: 200 y todos los pasos", res.status === 200 && json.steps.some((s) => s.name === "cierre"), json);
  check("ningún paso falló", json.ok, json.steps.filter((s) => !s.ok));
  if (live) {
    const now = await prisma.freeWebinar.findUnique({ where: { id: live.id }, select: { endedAt: true } });
    if (now && (now.endedAt?.getTime() ?? null) !== (live.endedAt?.getTime() ?? null)) {
      await prisma.freeWebinar.update({ where: { id: live.id }, data: { endedAt: live.endedAt } });
      await prisma.platformNotification.deleteMany({
        where: { eventType: "SYSTEM_ALERT", entityType: "FreeWebinar", entityId: live.id, createdAt: { gte: t0 } },
      });
    }
  }
  if (prevSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prevSecret;
};

const main = async () => {
  try {
    await remindersPart();
    await splitPart();
    await cronPart();
  } finally {
    await cleanup().catch((e) => console.error("limpieza:", e));
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Recordatorios del evento OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
