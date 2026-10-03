/**
 * Talleres como los eventos gratuitos, de punta a punta, contra la base de
 * DESARROLLO y con WhatsApp en modo prueba (no sale nada de verdad):
 *
 * - «Nuevo taller» deja un borrador; publicar se niega sin precio en pesos;
 * - con precio se publica, y publicar otra cierra la que estaba publicada
 *   (y deja de venderse);
 * - duplicar copia la página, nunca el precio, las inscritas, los documentos
 *   ni el enlace de la reunión;
 * - guardar no borra el cupo; cambiar la fecha devuelve los recordatorios a la
 *   cola (correo y WhatsApp);
 * - el recordatorio de 24 h por WhatsApp sale una vez, con el enlace;
 * - el reloj (`closeDueWorkshops`) da el taller por realizado y lo anota;
 * - la historia lo cuenta todo; borrar solo sin pagos y sin publicar;
 * - el asistente (create_workshop / update_workshop) sigue funcionando y pasa
 *   por los mismos pasos.
 *
 * Crea sus propias ediciones (URLs únicas) y deja la base como estaba: las
 * ediciones que ya existían vuelven a su estado.
 *
 *   bun scripts/workshop-editions-e2e.ts   (también en `bun run e2e:whatsapp`)
 */
import createWorkshopTool from "@/agent/tools/create_workshop";
import updateWorkshopTool from "@/agent/tools/update_workshop";
import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting, deleteSiteSetting } from "@/lib/crm/site-settings";
import {
  createWorkshopDocument,
  createWorkshopEdition,
  duplicateWorkshopEdition,
  updateWorkshopEditionBySlug,
} from "@/lib/crm/workshop-editions";
import {
  closeDueWorkshops,
  deleteWorkshopEdition,
  endWorkshopEdition,
  publishWorkshopEdition,
  reopenWorkshopEdition,
  unpublishWorkshopEdition,
  WorkshopLifecycleError,
  WorkshopPublishError,
} from "@/lib/crm/workshop-lifecycle";
import { getWorkshopTimeline, listWorkshopsForPanel } from "@/lib/crm/workshop-panel";
import { syncWorkshopEditionPrice } from "@/lib/crm/workshop-pricing";
import { workshopProductIdFor } from "@/lib/crm/workshop-price-rows";
import {
  sendWorkshopWhatsAppReminders,
  WORKSHOP_WA_REMINDERS_SETTING,
  WORKSHOP_WA_TEMPLATE_KEY,
} from "@/lib/crm/workshop-whatsapp-reminders";
import { createSend } from "@/lib/crm/whatsapp-sends";
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
const MEET = "https://zoom.us/j/e2e-talleres";
const PHONES = { open: "+573000007791", never: "+573000007792", optout: "+573000007793" } as const;
const threads = Object.values(PHONES).map((p) => whatsAppDigits(p));

const TEMPLATE = {
  title: "Taller: recordatorio",
  body: "Hola {{nombre}}, te recuerdo que {{evento}} es el {{fecha}}. Ingresa aquí: {{enlace}} ¡Te espero!",
  metaTemplateName: "taller_recordatorio",
  metaTemplateLang: "es",
  metaCategory: "UTILITY",
  metaBody: "Hola {{1}}, te recuerdo que {{2}} es el {{3}}. Ingresa aquí: {{4}} ¡Te espero!",
  metaVarNames: ["nombre", "evento", "fecha", "enlace"],
};

const createdIds: string[] = [];
const contactIds: string[] = [];
let snapshot: {
  id: string;
  slug: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";
  endedAt: Date | null;
  publishedAt: Date | null;
}[] = [];
let ownProducts: { id: string; isActive: boolean }[] = [];
let templateBefore: Awaited<ReturnType<typeof prisma.messageTemplate.findFirst>> = null;
let waSettingBefore: string | null = null;

const restore = async () => {
  const created = await prisma.workshopEdition.findMany({ where: { id: { in: createdIds } }, select: { slug: true } });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } } });
  await prisma.whatsAppSend.deleteMany({ where: { workshopEditionId: { in: createdIds } } });
  await prisma.contact.deleteMany({ where: { phoneE164: { in: Object.values(PHONES) } } }).catch(() => undefined);
  await prisma.workshopEdition.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.product.deleteMany({ where: { id: { in: created.map((c) => workshopProductIdFor(c.slug)) } } });
  await prisma.platformNotification.deleteMany({
    where: { entityType: "WorkshopEdition", entityId: { in: createdIds } },
  });
  await prisma.auditLog.deleteMany({ where: { entityType: "WorkshopEdition", entityId: { in: createdIds } } });
  // Las de antes, como estaban (publicar las de la prueba las cerró).
  for (const row of snapshot) {
    await prisma.workshopEdition.update({
      where: { id: row.id },
      data: { status: row.status, endedAt: row.endedAt, publishedAt: row.publishedAt },
    });
  }
  for (const p of ownProducts) {
    await prisma.product.update({ where: { id: p.id }, data: { isActive: p.isActive } });
  }
  await prisma.workshopEditionActivity.deleteMany({
    where: { workshopEditionId: { in: snapshot.map((r) => r.id) }, at: { gte: t0 } },
  });
  if (templateBefore) {
    const { id, ...rest } = templateBefore;
    await prisma.messageTemplate.update({ where: { id }, data: rest });
  } else {
    await prisma.messageTemplate.deleteMany({ where: { key: WORKSHOP_WA_TEMPLATE_KEY } });
  }
  if (waSettingBefore === null) await deleteSiteSetting(WORKSHOP_WA_REMINDERS_SETTING).catch(() => undefined);
  else await setSiteSetting(WORKSHOP_WA_REMINDERS_SETTING, waSettingBefore);
};

const upsertContact = async (phone: string, firstName: string, notifyWhatsapp = true) => {
  const c = await prisma.contact.upsert({
    where: { phoneE164: phone },
    create: {
      phoneE164: phone,
      firstName,
      lastName: `Taller${run}`,
      email: `e2e-taller-${run}-${phone.slice(-2)}@example.com`,
      notifyWhatsapp,
    },
    update: { firstName, lastName: `Taller${run}`, notifyWhatsapp, timezone: "America/Bogota", phoneCountryIso: null },
    select: { id: true },
  });
  contactIds.push(c.id);
  return c.id;
};

const main = async () => {
  console.log("\n0. Preparar: WhatsApp en modo prueba, la plantilla del taller aprobada");
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  check("WhatsApp en modo prueba", await resolveDryRun());
  if (!(await resolveDryRun())) throw new Error("El modo prueba no está activo: no sigo.");
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER" }, select: { id: true } });
  const actor = { staffUserId: staff.id };
  const toolCtx = { session: { auth: { current: { principalId: staff.id, attributes: { role: "OWNER" } } } } } as never;

  snapshot = await prisma.workshopEdition.findMany({
    select: { id: true, slug: true, status: true, endedAt: true, publishedAt: true },
  });
  ownProducts = await prisma.product.findMany({
    where: { id: { in: snapshot.map((s) => workshopProductIdFor(s.slug)) } },
    select: { id: true, isActive: true },
  });
  templateBefore = await prisma.messageTemplate.findFirst({ where: { key: WORKSHOP_WA_TEMPLATE_KEY, locale: "es" } });
  waSettingBefore = await getSiteSetting(WORKSHOP_WA_REMINDERS_SETTING).catch(() => null);
  await setSiteSetting(WORKSHOP_WA_REMINDERS_SETTING, "true");
  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: WORKSHOP_WA_TEMPLATE_KEY, locale: "es" } },
    create: { key: WORKSHOP_WA_TEMPLATE_KEY, locale: "es", ...TEMPLATE, metaApprovalStatus: "APPROVED" },
    update: { ...TEMPLATE, metaApprovalStatus: "APPROVED" },
  });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } } });

  console.log("\n1. «Nuevo taller»: un borrador con lo mínimo");
  const startsAt = new Date(Math.floor((Date.now() + 20 * H) / 60_000) * 60_000);
  const a = await createWorkshopEdition({ title: `Taller E2E ${run}`, startsAt }, actor);
  createdIds.push(a.id);
  check("nace en borrador, con su fecha y sin precio ni enlace", a.status === "DRAFT" && a.startsAt?.getTime() === startsAt.getTime() && !a.productId && !a.meetingUrl);
  check("sin descripción inventada", a.cardSummary === null);

  console.log("\n2. Publicar pide descripción y precio en pesos");
  const refused = await publishWorkshopEdition(a.id, actor).catch((e: unknown) => e);
  check(
    "sin precio en pesos no se publica",
    refused instanceof WorkshopPublishError && refused.blockers.includes("priceCop") && refused.blockers.includes("description"),
    refused instanceof WorkshopPublishError ? refused.blockers : String(refused)
  );
  await updateWorkshopEditionBySlug(
    a.slug,
    {
      title: a.title,
      cardSummary: "Una jornada en vivo para soltar lo que pesa.",
      capacity: 30,
      meetingUrl: MEET,
      focusTopics: ["Creencias", "Hábitos"],
      daySchedule: [{ startTime: "09:00", endTime: "12:00", title: "Mañana" }],
      editionLabel: "Edición E2E",
    },
    actor
  );
  const onlyPrice = await publishWorkshopEdition(a.id, actor).catch((e: unknown) => e);
  check(
    "con la página completa, solo falta el precio",
    onlyPrice instanceof WorkshopPublishError && onlyPrice.blockers.join() === "priceCop",
    onlyPrice instanceof WorkshopPublishError ? onlyPrice.blockers : String(onlyPrice)
  );
  await syncWorkshopEditionPrice({ slug: a.slug, title: a.title, status: "DRAFT", copPesos: 180000, usdCents: 4500, staffUserId: staff.id });
  const preexistingOpen = snapshot.filter((s) => s.status === "OPEN").map((s) => s.id);
  const pubA = await publishWorkshopEdition(a.id, actor);
  check("con precio en pesos, se publica", pubA.edition.status === "OPEN" && pubA.edition.publishedAt !== null);
  check(
    "las de la base que estaban publicadas pasan a cerradas",
    preexistingOpen.every((id) => pubA.closed.some((c) => c.id === id)),
    { preexistingOpen, closed: pubA.closed.map((c) => c.id) }
  );
  const productA = await prisma.product.findUnique({ where: { id: workshopProductIdFor(a.slug) } });
  check("y se vende (su producto activo)", productA?.isActive === true);

  console.log("\n3. Guardar no borra lo que no llega");
  await updateWorkshopEditionBySlug(a.slug, { title: a.title, cardSummary: "Una jornada en vivo, otra vez." }, actor);
  const afterEdit = await prisma.workshopEdition.findUniqueOrThrow({ where: { id: a.id } });
  check(
    "el cupo, la etiqueta, el enlace y la fecha siguen",
    afterEdit.capacity === 30 &&
      afterEdit.editionLabel === "Edición E2E" &&
      afterEdit.meetingUrl === MEET &&
      afterEdit.startsAt?.getTime() === startsAt.getTime(),
    afterEdit
  );
  check("sigue publicado", afterEdit.status === "OPEN");

  console.log("\n4. Duplicar copia la página, no lo demás");
  await createWorkshopDocument({
    workshopEditionId: a.id,
    url: `https://example.com/e2e-${run}.pdf`,
    filename: "guia.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  });
  const dup = await duplicateWorkshopEdition(a.id, actor);
  createdIds.push(dup.id);
  check(
    "la página sí (título, descripción, temas, cronograma, cupo)",
    dup.title === a.title &&
      dup.cardSummary === "Una jornada en vivo, otra vez." &&
      JSON.stringify(dup.focusTopics) === JSON.stringify(["Creencias", "Hábitos"]) &&
      Array.isArray(dup.daySchedule) &&
      dup.capacity === 30,
    dup
  );
  check(
    "ni fecha, ni precio, ni enlace, ni documentos, ni inscritas",
    dup.status === "DRAFT" &&
      dup.startsAt === null &&
      dup.meetingUrl === null &&
      dup.productId === null &&
      (await prisma.workshopDocument.count({ where: { workshopEditionId: dup.id } })) === 0 &&
      (await prisma.enrollment.count({ where: { workshopEditionId: dup.id } })) === 0
  );
  check("con su URL propia", dup.slug !== a.slug);

  console.log("\n5. Publicar otra cierra la publicada");
  const b = await createWorkshopEdition({ copyFromId: a.id, title: `Taller E2E B ${run}`, startsAt: new Date(Date.now() + 10 * 24 * H) }, actor);
  createdIds.push(b.id);
  await syncWorkshopEditionPrice({ slug: b.slug, title: b.title, status: "DRAFT", copPesos: 200000 });
  const pubB = await publishWorkshopEdition(b.id, actor);
  const aClosed = await prisma.workshopEdition.findUniqueOrThrow({ where: { id: a.id } });
  check("A pasa a «inscripciones cerradas»", aClosed.status === "CLOSED" && pubB.closed.some((c) => c.id === a.id));
  check(
    "y deja de venderse",
    (await prisma.product.findUniqueOrThrow({ where: { id: workshopProductIdFor(a.slug) } })).isActive === false
  );

  console.log("\n6. Inscritas pagadas; cambiar la fecha devuelve los recordatorios a la cola");
  const cOpen = await upsertContact(PHONES.open, "Abierta");
  const cNever = await upsertContact(PHONES.never, "Nunca");
  const cOptout = await upsertContact(PHONES.optout, "Baja", false);
  await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: whatsAppDigits(PHONES.open),
      metaAccountId: "test-phone-id",
      participantName: "Abierta",
      contactId: cOpen,
      lastInboundAt: new Date(Date.now() - H),
      lastMessageAt: new Date(),
    },
  });
  const product = workshopProductIdFor(a.slug);
  for (const contactId of [cOpen, cNever, cOptout]) {
    await prisma.enrollment.create({
      data: {
        contactId,
        productId: product,
        workshopEditionId: a.id,
        status: "ACTIVE",
        paidAt: new Date(),
        workshopReminder24hSentAt: new Date(),
        workshopReminder24hWaSentAt: new Date(),
        workshopWaReminderError: "viejo",
      },
    });
  }
  const moved = new Date(startsAt.getTime() + 60_000);
  await updateWorkshopEditionBySlug(a.slug, { title: a.title, startsAt: moved }, actor);
  const flags = await prisma.enrollment.findMany({
    where: { workshopEditionId: a.id },
    select: { workshopReminder24hSentAt: true, workshopReminder24hWaSentAt: true, workshopWaReminderError: true },
  });
  check(
    "los sellos de correo y WhatsApp vuelven a cero",
    flags.length === 3 && flags.every((f) => !f.workshopReminder24hSentAt && !f.workshopReminder24hWaSentAt && !f.workshopWaReminderError),
    flags
  );

  console.log("\n7. Recordatorio de 24 h por WhatsApp (A está cerrada: sigue saliendo a quien pagó)");
  const r1 = await sendWorkshopWhatsAppReminders({ pass: "24h", editionId: a.id });
  check("salen 2 (la que se dio de baja no)", r1.sent === 2 && r1.failed === 0 && r1.skipped === 0 && r1.remaining === 0, r1);
  const r2 = await sendWorkshopWhatsAppReminders({ pass: "24h", editionId: a.id });
  check("una segunda pasada no manda nada", r2.sent === 0 && r2.failed === 0 && r2.skipped === 0, r2);
  const msgs = await prisma.conversationMessage.findMany({
    where: { source: `taller:${a.id}:24h` },
    select: { body: true, isAutoReply: true, conversation: { select: { externalThreadId: true } } },
  });
  check("2 mensajes, marcados como automáticos", msgs.length === 2 && msgs.every((m) => m.isAutoReply), msgs.length);
  check(
    "con el enlace, «tu taller «…»» y la hora de Colombia",
    msgs.every((m) => m.body?.includes(MEET) && m.body.includes(`tu taller «${a.title}»`) && m.body.includes("hora de Colombia")),
    msgs.map((m) => m.body)
  );
  const textBody = msgs.find((m) => m.conversation.externalThreadId === whatsAppDigits(PHONES.open))?.body ?? "";
  check("texto libre: las palabras de la plantilla", textBody.startsWith("Hola Abierta, te recuerdo que") && textBody.endsWith("¡Te espero!"), textBody);
  const optout = await prisma.enrollment.findFirstOrThrow({ where: { workshopEditionId: a.id, contactId: cOptout } });
  check("la de baja ni se sella", optout.workshopReminder24hWaSentAt === null);
  const outside = await sendWorkshopWhatsAppReminders({ pass: "1h", editionId: a.id });
  check("el de 1 h todavía no toca", outside.reason === "outside_window" && outside.sent === 0, outside);

  console.log("\n8. Un envío por WhatsApp desde el taller queda en su historia");
  const send = await createSend({
    title: `Taller: ${a.title} · Invitación`,
    kind: "taller",
    text: "Hola {{nombre}}, prueba",
    contactIds: [cOpen],
    staffId: staff.id,
    workshopEditionId: a.id,
  });
  check("el envío queda ligado al taller", (await prisma.whatsAppSend.findUniqueOrThrow({ where: { id: send.id } })).workshopEditionId === a.id);

  console.log("\n9. El reloj da por realizado el taller que ya pasó");
  await prisma.workshopEdition.update({ where: { id: a.id }, data: { startsAt: new Date(Date.now() - 4 * H) } });
  const closed1 = await closeDueWorkshops();
  const aDone = await prisma.workshopEdition.findUniqueOrThrow({ where: { id: a.id } });
  check("A realizado y sellado", closed1.some((w) => w.id === a.id) && aDone.status === "COMPLETED" && aDone.endedAt !== null);
  check("B (todavía no pasa) sigue publicado", (await prisma.workshopEdition.findUniqueOrThrow({ where: { id: b.id } })).status === "OPEN");
  const closed2 = await closeDueWorkshops();
  check("un segundo tick no lo cierra dos veces", !closed2.some((w) => w.id === a.id));
  const endedActs = await prisma.workshopEditionActivity.findMany({ where: { workshopEditionId: a.id, kind: "ended" } });
  check("anotado una vez, como cierre del reloj", endedActs.length === 1 && (endedActs[0].meta as { by?: string })?.by === "cron");
  const afterEnd = await sendWorkshopWhatsAppReminders({ pass: "1h", editionId: a.id, ignoreWindow: true });
  check("terminado, no sale ningún recordatorio más", afterEnd.reason === "ended" && afterEnd.sent === 0, afterEnd);

  console.log("\n10. La historia lo cuenta");
  const timeline = await getWorkshopTimeline(a.id, "America/Bogota");
  const kinds = new Set(timeline.items.map((i) => i.kind));
  for (const k of ["created", "price_changed", "published", "closed", "date_changed", "reminder_24h_wa", "ended"]) {
    check(`historia: ${k}`, kinds.has(k), [...kinds]);
  }
  check("historia: el envío por WhatsApp, con su enlace al detalle", timeline.items.some((i) => i.sendId === send.id));
  check("pagos por día y recordatorios contados", timeline.enrollments === 3 && timeline.perDay.length > 0 && timeline.flags.wa24h.count === 2);
  const listed = (await listWorkshopsForPanel()).find((w) => w.id === a.id);
  check("en la lista, A va a «Pasados» con sus 3 pagadas", listed?.ended === true && listed.stats.paid === 3, listed);

  console.log("\n11. Borrar, cerrar inscripciones y reabrir");
  const delOpen = await deleteWorkshopEdition(b.id).catch((e: unknown) => e);
  check("publicada no se borra", delOpen instanceof WorkshopLifecycleError && delOpen.reason === "open", String(delOpen));
  const unpub = await unpublishWorkshopEdition(b.id, actor);
  check("cerrar inscripciones la deja cerrada", unpub.status === "CLOSED");
  const delPaid = await deleteWorkshopEdition(a.id).catch((e: unknown) => e);
  check("con pagos no se borra", delPaid instanceof WorkshopLifecycleError && delPaid.reason === "has_paid_enrollments", String(delPaid));
  const reopened = await reopenWorkshopEdition(a.id, actor);
  check("reabrir: cerrada y sin sello de fin", reopened.status === "CLOSED" && reopened.endedAt === null);
  const reended = await endWorkshopEdition(a.id, { by: "staff", staffUserId: staff.id });
  check("y se puede volver a terminar", reended);
  await deleteWorkshopEdition(dup.id);
  check("un borrador sin pagos sí se borra", (await prisma.workshopEdition.count({ where: { id: dup.id } })) === 0);

  console.log("\n12. El asistente sigue funcionando y pasa por los mismos pasos");
  const created = (await createWorkshopTool.execute(
    { title: `Taller E2E agente ${run}`, cardSummary: "Del asistente.", status: "OPEN", priceCop: 150000, capacity: 12 },
    toolCtx
  )) as { edition: { slug: string; status: string; capacity: number | null; link: string | null } };
  const agentRow = await prisma.workshopEdition.findUniqueOrThrow({ where: { slug: created.edition.slug } });
  createdIds.push(agentRow.id);
  check(
    "create_workshop con OPEN: publicado, con su precio y su cupo",
    created.edition.status === "OPEN" && created.edition.capacity === 12 && Boolean(created.edition.link),
    created
  );
  check(
    "se vende y queda en su historia",
    (await prisma.product.findUniqueOrThrow({ where: { id: workshopProductIdFor(agentRow.slug) } })).isActive === true &&
      (await prisma.workshopEditionActivity.count({ where: { workshopEditionId: agentRow.id, kind: "published" } })) === 1
  );
  const upd = (await updateWorkshopTool.execute(
    { slug: agentRow.slug, title: agentRow.title, status: "COMPLETED" },
    toolCtx
  )) as { edition: { status: string; capacity: number | null } };
  const agentDone = await prisma.workshopEdition.findUniqueOrThrow({ where: { id: agentRow.id } });
  check(
    "update_workshop con COMPLETED lo termina (sello y producto inactivo) sin borrar el cupo",
    upd.edition.status === "COMPLETED" &&
      agentDone.endedAt !== null &&
      agentDone.capacity === 12 &&
      (await prisma.product.findUniqueOrThrow({ where: { id: workshopProductIdFor(agentRow.slug) } })).isActive === false,
    { upd, agentDone }
  );
};

main()
  .catch((e) => {
    console.error(e);
    failures.push(`excepción: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    await restore().catch((e) => {
      console.error("No se pudo dejar la base como estaba:", e);
      failures.push("restore");
    });
    if (failures.length) {
      console.log(`\n❌ ${failures.length} fallos:\n- ${failures.join("\n- ")}`);
      process.exit(1);
    }
    console.log("\n✅ Talleres como ediciones OK");
    process.exit(0);
  });
