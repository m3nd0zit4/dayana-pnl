/**
 * Eventos gratuitos como ediciones (como los talleres), de punta a punta, contra
 * la base de DESARROLLO y con WhatsApp en modo prueba (no sale nada de verdad):
 *
 * - dos borradores; publicar A; publicar B cierra A y B pasa a ser el actual;
 * - la landing (`/eventos-gratuitos`) y el alias «gratuito» resuelven a B;
 * - una inscripción con el formulario de A (cerrado) va a B, por la ruta real;
 * - la confirmación por WhatsApp sale una sola vez y queda sellada;
 * - cada evento conserva sus inscritas;
 * - un envío masivo queda ligado al evento y aparece en su historia;
 * - terminar B y el cierre del reloj dejan el evento realizado y anotado;
 * - duplicar copia la página, no las inscritas; borrar solo sin inscritas;
 * - la herramienta del agente `get_free_webinar` devuelve el evento actual.
 *
 * Deja la base como estaba: las filas que ya existían vuelven a su estado.
 *
 *   bun scripts/free-event-editions-e2e.ts   (también en `bun run e2e:eventos`)
 */
import { NextRequest } from "next/server";

import deactivateFreeWebinarTool from "@/agent/tools/deactivate_free_webinar";
import getFreeWebinarTool from "@/agent/tools/get_free_webinar";
import updateFreeWebinarTool from "@/agent/tools/update_free_webinar";
import { POST as leadsPost } from "@/app/api/leads/route";
import { prisma } from "@/lib/db";
import {
  EVENT_CONFIRMATION_TEMPLATE_KEY,
  sendFreeEventConfirmationWhatsApp,
} from "@/lib/crm/free-event-confirmation";
import { getFreeEventTimeline, listFreeEventPeople, listFreeEvents } from "@/lib/crm/free-events";
import {
  clearFreeWebinarSchedule,
  closeDueFreeEvents,
  createFreeEvent,
  deleteFreeEvent,
  duplicateFreeEvent,
  endFreeEvent,
  findFreeEventByPublicSlug,
  FreeEventLifecycleError,
  FreeWebinarPublishError,
  getCurrentFreeEvent,
  getFreeWebinar,
  getOpenFreeEvent,
  publishFreeEvent,
  resetFreeWebinar,
  resolveRegistrationEvent,
  updateFreeWebinar,
} from "@/lib/crm/free-webinar";
import { drainWebinarMail, resendWebinarMailToAll, sendPendingWebinarLinkEmails } from "@/lib/crm/webinar-mailer";
import { recordWebinarRegistration } from "@/lib/crm/webinar-registrations";
import { createSend, processNextBatch } from "@/lib/crm/whatsapp-sends";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { resolveDryRun } from "@/lib/notifications/platform/resolve";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const t0 = new Date();
const DAY = 86_400_000;
const PHONES = { lead: "+573000007781", direct: "+573000007782", bot: "+573000007783" } as const;
const MEET = "https://meet.google.com/e2e-ediciones";

/** `YYYY-MM-DD` en Bogotá, a `days` días de hoy. */
const dateIn = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + days * DAY)
  );

const createdIds: string[] = [];
const contactIds: string[] = [];
let snapshot: {
  id: string;
  slug: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED";
  isActive: boolean;
  publishedAt: Date | null;
  endedAt: Date | null;
  previousSlugs: string[];
}[] = [];
let templateBefore: { metaApprovalStatus: string | null } | null = null;

const threads = Object.values(PHONES).map((p) => p.replace(/\D/g, ""));

const restore = async () => {
  await prisma.whatsAppSend.deleteMany({ where: { freeWebinarId: { in: createdIds } } });
  await prisma.freeWebinar.deleteMany({ where: { id: { in: createdIds } } });
  // Primero se liberan los slugs (por si el publicado renombró la fila
  // heredada), luego cada fila vuelve a como estaba.
  for (const row of snapshot) {
    await prisma.freeWebinar.update({ where: { id: row.id }, data: { slug: `restore-${row.id}` } });
  }
  for (const row of snapshot) {
    await prisma.freeWebinar.update({
      where: { id: row.id },
      data: {
        slug: row.slug,
        status: row.status,
        isActive: row.isActive,
        publishedAt: row.publishedAt,
        endedAt: row.endedAt,
        previousSlugs: { set: row.previousSlugs },
      },
    });
  }
  await prisma.freeEventActivity.deleteMany({
    where: { freeWebinarId: { in: snapshot.map((r) => r.id) }, at: { gte: t0 } },
  });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } } });
  await prisma.platformNotification.deleteMany({
    where: { entityType: "Contact", entityId: { in: contactIds }, createdAt: { gte: t0 } },
  });
  await prisma.contact.deleteMany({ where: { phoneE164: { in: Object.values(PHONES) } } }).catch(() => undefined);
  if (templateBefore === null) {
    await prisma.messageTemplate.deleteMany({ where: { key: EVENT_CONFIRMATION_TEMPLATE_KEY } });
  } else {
    await prisma.messageTemplate.updateMany({
      where: { key: EVENT_CONFIRMATION_TEMPLATE_KEY },
      data: { metaApprovalStatus: templateBefore.metaApprovalStatus },
    });
  }
};

const main = async () => {
  console.log("\n0. Preparar: modo prueba de WhatsApp y la plantilla de confirmación aprobada");
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  check("WhatsApp en modo prueba", await resolveDryRun());
  if (!(await resolveDryRun())) throw new Error("El modo prueba no está activo: no sigo.");
  const staff = await prisma.staffUser.findFirstOrThrow({ select: { id: true } });
  const actor = { staffUserId: staff.id };

  snapshot = await prisma.freeWebinar.findMany({
    select: { id: true, slug: true, status: true, isActive: true, publishedAt: true, endedAt: true, previousSlugs: true },
  });
  templateBefore = await prisma.messageTemplate.findFirst({
    where: { key: EVENT_CONFIRMATION_TEMPLATE_KEY },
    select: { metaApprovalStatus: true },
  });
  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: EVENT_CONFIRMATION_TEMPLATE_KEY, locale: "es" } },
    create: {
      key: EVENT_CONFIRMATION_TEMPLATE_KEY,
      locale: "es",
      title: "Evento gratuito: confirmación de inscripción",
      body: "Hola {{nombre}}, quedaste inscrita en {{evento}} el {{fecha}}. Te mando el enlace para entrar por aquí antes de empezar.",
      metaTemplateName: EVENT_CONFIRMATION_TEMPLATE_KEY,
      metaTemplateLang: "es",
      metaApprovalStatus: "APPROVED",
      metaCategory: "UTILITY",
      metaBody: "Hola {{1}}, quedaste inscrita en {{2}} el {{3}}. Te mando el enlace para entrar por aquí antes de empezar.",
      metaVarNames: ["nombre", "evento", "fecha"],
    },
    update: { metaApprovalStatus: "APPROVED" },
  });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: { in: threads } } });

  console.log("\n1. Dos borradores");
  const a = await createFreeEvent(
    { headline: `E2E Ediciones A ${run}`, startsAtLocal: { date: dateIn(10), time: "10:00" } },
    actor
  );
  createdIds.push(a.id);
  const b = await createFreeEvent(
    { headline: `E2E Ediciones B ${run}`, startsAtLocal: { date: dateIn(20), time: "18:30" } },
    actor
  );
  createdIds.push(b.id);
  check("A y B en borrador, sin publicar", a.status === "DRAFT" && !a.isActive && b.status === "DRAFT" && !b.isActive, {
    a: a.status,
    b: b.status,
  });
  check("URL legible: titular + fecha", a.slug === `e2e-ediciones-a-${run}-${dateIn(10)}`, a.slug);
  check("la página propia usa esa URL", a.publicPath === `/eventos-gratuitos/${a.slug}`, a.publicPath);
  const renamed = await updateFreeWebinar({ headline: `E2E Ediciones A2 ${run}` }, a.id, actor);
  check("mientras es borrador, la URL sigue al titular", renamed.webinar.slug === `e2e-ediciones-a2-${run}-${dateIn(10)}`, renamed.webinar.slug);
  await updateFreeWebinar({ headline: `E2E Ediciones A ${run}` }, a.id, actor);
  const createdActs = await prisma.freeEventActivity.count({ where: { freeWebinarId: { in: [a.id, b.id] }, kind: "created" } });
  check("cada uno con «creado» en su historia", createdActs === 2, createdActs);

  console.log("\n2. Publicar A, luego B");
  const noDate = await createFreeEvent({ headline: `E2E sin fecha ${run}` }, actor);
  createdIds.push(noDate.id);
  const blocked = await publishFreeEvent(noDate.id, actor).then(
    () => null,
    (e: unknown) => e
  );
  check(
    "no se publica sin fecha",
    blocked instanceof FreeWebinarPublishError && blocked.blockers.includes("startsAt"),
    String(blocked)
  );

  const pubA = await publishFreeEvent(a.id, actor);
  check("A publicado", pubA.webinar.status === "OPEN" && pubA.webinar.isActive && pubA.webinar.publishedAt !== null, pubA.webinar.status);
  const legacyBefore = snapshot.find((r) => r.slug === "gratuito");
  if (legacyBefore) {
    const legacyNow = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: legacyBefore.id } });
    check(
      "la fila heredada «gratuito» recibe su URL propia (el alias queda libre)",
      legacyNow.slug !== "gratuito" && !legacyNow.previousSlugs.includes("gratuito"),
      legacyNow.slug
    );
  }

  const pubB = await publishFreeEvent(b.id, actor);
  const aAfter = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: a.id } });
  check("publicar B cierra las inscripciones de A", aAfter.status === "CLOSED" && !aAfter.isActive, {
    status: aAfter.status,
    isActive: aAfter.isActive,
  });
  check("y lo dice", pubB.closed.some((c) => c.id === a.id), pubB.closed);
  check("B publicado", pubB.webinar.status === "OPEN" && pubB.webinar.isActive);
  const openCount = await prisma.freeWebinar.count({ where: { status: "OPEN" } });
  check("un solo evento publicado", openCount === 1, openCount);
  const closedAct = await prisma.freeEventActivity.findFirst({ where: { freeWebinarId: a.id, kind: "closed" } });
  check(
    "la historia de A dice que se publicó B",
    (closedAct?.meta as { byEventId?: string } | null)?.byEventId === b.id,
    closedAct?.meta
  );
  check("B es el evento actual", (await getCurrentFreeEvent())?.id === b.id);

  console.log("\n3. La web y el alias");
  check("/eventos-gratuitos muestra B", (await getOpenFreeEvent())?.id === b.id);
  check("«gratuito» es el alias del actual", (await findFreeEventByPublicSlug("gratuito")).kind === "current");
  const pageA = await findFreeEventByPublicSlug(a.slug);
  check("la página de A existe (con inscripciones cerradas)", pageA.kind === "event" && pageA.event.status === "CLOSED", pageA.kind);
  await prisma.freeWebinar.update({ where: { id: a.id }, data: { previousSlugs: { set: [`e2e-vieja-${run}`] } } });
  const old = await findFreeEventByPublicSlug(`e2e-vieja-${run}`);
  check("una URL vieja redirige a la de ahora", old.kind === "redirect" && old.to === `/eventos-gratuitos/${a.slug}`, old);
  check("una que no existe, no", (await findFreeEventByPublicSlug(`e2e-nada-${run}`)).kind === "not_found");
  check("sin id, getFreeWebinar() es el actual", (await getFreeWebinar())?.id === b.id);

  console.log("\n4. Inscribirse con el formulario de A (cerrado) → va a B, por la ruta real");
  check("resolver: A cerrado → B", (await resolveRegistrationEvent(a.id))?.id === b.id);
  check("resolver: B abierto → B", (await resolveRegistrationEvent(b.id))?.id === b.id);
  const lead = async () => {
    const res = await leadsPost(
      new NextRequest("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.77.${run % 250}.1` },
        body: JSON.stringify({
          firstName: "Ediciones",
          lastName: `Prueba${run}`,
          email: `e2e-ediciones-${run}@example.com`,
          phone: PHONES.lead,
          phoneCountry: "CO",
          source: "web_lead_form",
          sourceDetail: "Webinar gratuito",
          interest: "Webinar gratuito",
          notify: true,
          consentData: true,
          tag: "webinar-gratuito",
          freeEventId: a.id,
        }),
      })
    );
    return { status: res.status, json: (await res.json()) as { ok?: boolean; contactId?: string; freeEventId?: string; alreadyRegistered?: boolean } };
  };
  const first = await lead();
  check("la ruta responde ok y dice a qué evento fue", first.status === 200 && first.json.freeEventId === b.id, first);
  const leadContactId = first.json.contactId!;
  contactIds.push(leadContactId);
  const regB = await prisma.webinarRegistration.findUnique({
    where: { webinarId_contactId: { webinarId: b.id, contactId: leadContactId } },
  });
  const regA = await prisma.webinarRegistration.count({ where: { webinarId: a.id, contactId: leadContactId } });
  check("inscrita en B, no en A", regB !== null && regA === 0, { regB: Boolean(regB), regA });

  console.log("\n5. Confirmación por WhatsApp: una sola vez y sellada");
  check("sellada al inscribirse", regB?.confirmationWaSentAt != null && regB.confirmationWaError === null, regB);
  const confirmations = () =>
    prisma.conversationMessage.findMany({
      where: { source: `evento:${b.id}:confirmacion` },
      select: { body: true, isAutoReply: true },
    });
  const msgs = await confirmations();
  check("un mensaje en su chat, marcado como automático", msgs.length === 1 && msgs[0].isAutoReply, msgs.length);
  check(
    "dice «quedaste inscrita en «…» el <día>»",
    /^Hola Ediciones, quedaste inscrita en «E2E Ediciones B \d+» el (lunes|martes|miércoles|jueves|viernes|sábado|domingo) /.test(
      msgs[0]?.body ?? ""
    ),
    msgs[0]?.body
  );
  const again = await sendFreeEventConfirmationWhatsApp({ webinarId: b.id, contactId: leadContactId });
  check("volver a pedirla no manda otra", again.status === "skipped" && again.reason === "already_sent", again);
  const second = await lead();
  check("reinscribirse: «ya estabas» y sin segundo WhatsApp", second.json.alreadyRegistered === true && (await confirmations()).length === 1, {
    already: second.json.alreadyRegistered,
    msgs: (await confirmations()).length,
  });
  await updateFreeWebinar({ waConfirmationEnabled: false }, a.id, actor);
  const direct = await prisma.contact.create({
    data: { phoneE164: PHONES.direct, firstName: "Directa", lastName: `Prueba${run}`, notifyWhatsapp: true },
  });
  contactIds.push(direct.id);
  await recordWebinarRegistration(a.id, direct.id);
  const off = await sendFreeEventConfirmationWhatsApp({ webinarId: a.id, contactId: direct.id });
  check("con la confirmación apagada en el evento, no sale", off.status === "skipped" && off.reason === "disabled", off);

  console.log("\n6. Cada evento con sus inscritas");
  const peopleA = await listFreeEventPeople({ eventId: a.id });
  const peopleB = await listFreeEventPeople({ eventId: b.id });
  check(
    "A: solo la directa; B: solo la del formulario",
    peopleA.people.map((p) => p.contactId).join() === direct.id && peopleB.people.map((p) => p.contactId).join() === leadContactId,
    { a: peopleA.people.length, b: peopleB.people.length }
  );
  const list = await listFreeEvents();
  const rowB = list.find((e) => e.id === b.id);
  check("la lista cuenta 1 inscrita y 1 confirmación en B", rowB?.registrations === 1 && rowB.stats.waConfirmation === 1, rowB?.stats);
  check("y B es el actual en la lista", rowB?.isCurrent === true);

  console.log("\n7. Enlace de la reunión, envío masivo e historia");
  const meet = await updateFreeWebinar({ meetUrl: MEET }, b.id, actor);
  check("poner el enlace queda en la historia", meet.meetUrlChanged && (await prisma.freeEventActivity.count({ where: { freeWebinarId: b.id, kind: "meet_link_set" } })) === 1);
  const drained = await drainWebinarMail("link", 20_000, true, b.id);
  const linkActs = await prisma.freeEventActivity.count({ where: { freeWebinarId: b.id, kind: "link_emails" } });
  check(
    "la pasada del enlace queda anotada si envió algo",
    drained.sent + drained.failed === 0 ? linkActs === 0 : linkActs === 1,
    { drained, linkActs }
  );
  const send = await createSend({
    title: `Evento: E2E Ediciones B ${run} · Recordatorio`,
    kind: "evento",
    text: `Hola {{nombre}}, te recuerdo el evento: ${MEET}`,
    templateKey: null,
    contactIds: [leadContactId],
    staffId: staff.id,
    freeWebinarId: b.id,
  });
  let progress = await processNextBatch(send.id, staff.id);
  for (let i = 0; i < 5 && progress.pending > 0; i++) progress = await processNextBatch(send.id, staff.id);
  const sendRow = await prisma.whatsAppSend.findUniqueOrThrow({ where: { id: send.id } });
  check("el envío queda ligado a B", sendRow.freeWebinarId === b.id);
  const timeline = await getFreeEventTimeline(b.id, "America/Bogota");
  const kinds = timeline.items.map((i) => i.kind);
  check("historia de B: creado y publicado", kinds.includes("created") && kinds.includes("published"), kinds);
  const sendItem = timeline.items.find((i) => i.sendId === send.id);
  check("historia de B: el envío, una vez, con sus números", sendItem !== undefined && timeline.items.filter((i) => i.sendId === send.id).length === 1 && sendItem.count === sendRow.sent, sendItem);
  check("historia de B: inscripciones por día", timeline.registrations === 1 && timeline.perDay.reduce((n, d) => n + d.count, 0) === 1, timeline.perDay);
  check("historia de B: la confirmación por WhatsApp contada", timeline.flags.waConfirmation.count === 1, timeline.flags.waConfirmation);

  console.log("\n8. Terminar B; el reloj cierra A cuando pasa su fecha");
  check("terminar B", await endFreeEvent(b.id, { by: "staff", staffUserId: staff.id }));
  const bEnded = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: b.id } });
  check("B realizado, sin página", bEnded.status === "COMPLETED" && !bEnded.isActive && bEnded.endedAt !== null);
  check("la historia lo anota", (await prisma.freeEventActivity.count({ where: { freeWebinarId: b.id, kind: "ended" } })) === 1);
  check("terminarlo otra vez no hace nada", !(await endFreeEvent(b.id, { by: "staff" })));
  check("sin evento publicado, la landing no tiene a quién mostrar", (await getOpenFreeEvent()) === null);
  await prisma.freeWebinar.update({ where: { id: a.id }, data: { startsAt: new Date(Date.now() - 4 * 3600_000), startsAtHasTime: true } });
  const closedNow = await closeDueFreeEvents();
  check("el reloj cierra A (con inscripciones cerradas y ya pasado)", closedNow.some((e) => e.id === a.id), closedNow.map((e) => e.id));
  const aDone = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: a.id } });
  const cronAct = await prisma.freeEventActivity.findFirst({ where: { freeWebinarId: a.id, kind: "ended" } });
  check("A realizado y anotado como cierre del reloj", aDone.status === "COMPLETED" && (cronAct?.meta as { by?: string } | null)?.by === "cron");
  check("un segundo tick no lo cierra dos veces", !(await closeDueFreeEvents()).some((e) => e.id === a.id));

  console.log("\n8b. Uno que ya pasó no se reprograma ni se le manda nada en masa");
  const stampsOf = () =>
    prisma.webinarRegistration.findMany({
      where: { webinarId: b.id },
      orderBy: { id: "asc" },
      select: {
        linkEmailSentAt: true,
        reminder24hSentAt: true,
        reminder1hSentAt: true,
        reminder24hWaSentAt: true,
        reminder1hWaSentAt: true,
        confirmationWaSentAt: true,
      },
    });
  const stampsBefore = JSON.stringify(await stampsOf());
  const endedErr = async (fn: () => Promise<unknown>) =>
    fn().then(
      () => null,
      (e: unknown) => (e instanceof FreeEventLifecycleError ? e.reason : String(e))
    );
  check(
    "cambiarle la fecha: no",
    (await endedErr(() => updateFreeWebinar({ startsAtLocal: { date: dateIn(30), time: "10:00" } }, b.id, actor))) === "ended"
  );
  check(
    "cambiarle el enlace: no",
    (await endedErr(() => updateFreeWebinar({ meetUrl: "https://meet.google.com/otro-enlace" }, b.id, actor))) === "ended"
  );
  check("volverlo a cero: no", (await endedErr(() => resetFreeWebinar(b.id, actor))) === "ended");
  check("quitarle la fecha: no", (await endedErr(() => clearFreeWebinarSchedule(b.id, actor))) === "ended");
  const bNow = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: b.id } });
  const copyEdit = await updateFreeWebinar(
    {
      subheadline: `Corrección ${run}`,
      // Lo que manda el panel en cada guardado: la misma fecha y el mismo enlace.
      startsAt: bNow.startsAt,
      startsAtHasTime: bNow.startsAtHasTime,
      meetUrl: bNow.meetUrl,
    },
    b.id,
    actor
  ).then(
    (r) => r,
    () => null
  );
  check("corregir un texto sí (aunque lleguen la misma fecha y enlace)", copyEdit?.webinar.subheadline === `Corrección ${run}`);
  check("los sellos de sus inscritas siguen intactos", JSON.stringify(await stampsOf()) === stampsBefore);
  await prisma.webinarRegistration.updateMany({ where: { webinarId: b.id }, data: { linkEmailSentAt: null } });
  const endedLink = await sendPendingWebinarLinkEmails(undefined, b.id);
  const stillPending = await prisma.webinarRegistration.count({ where: { webinarId: b.id, linkEmailSentAt: null } });
  check("el reparto del enlace se salta un evento terminado", endedLink.skipped && endedLink.reason === "ended" && stillPending === 1, endedLink);
  const endedAll = await resendWebinarMailToAll("link", b.id);
  check("«reenviar a todas» tampoco (y no devuelve a nadie a la cola)", endedAll.reason === "ended" && endedAll.requeued === 0, endedAll);

  console.log("\n9. Duplicar y borrar");
  const c = await duplicateFreeEvent(b.id, actor);
  createdIds.push(c.id);
  const bFull = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: b.id } });
  const cFull = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: c.id } });
  check(
    "copia la página…",
    cFull.headline === bFull.headline &&
      JSON.stringify(cFull.learnItems) === JSON.stringify(bFull.learnItems) &&
      cFull.eventLabel === bFull.eventLabel &&
      cFull.ctaLabel === bFull.ctaLabel
  );
  check(
    "…pero no la fecha, el enlace ni las inscritas",
    cFull.status === "DRAFT" && cFull.startsAt === null && cFull.meetUrl === null && (await prisma.webinarRegistration.count({ where: { webinarId: c.id } })) === 0
  );
  const copyAct = await prisma.freeEventActivity.findFirst({ where: { freeWebinarId: c.id, kind: "created" } });
  check("su historia dice de dónde salió", (copyAct?.meta as { copiedFromId?: string } | null)?.copiedFromId === b.id);
  const cannot = await deleteFreeEvent(b.id).then(
    () => null,
    (e: unknown) => e
  );
  check("con inscritas no se borra", cannot instanceof FreeEventLifecycleError && cannot.reason === "has_registrations", String(cannot));
  await deleteFreeEvent(c.id);
  check("sin inscritas, sí", (await prisma.freeWebinar.count({ where: { id: c.id } })) === 0);

  console.log("\n10. El agente ve el evento actual");
  // Sin borradores, el actual es el último realizado (justo lo que pasa en
  // producción tras un evento y antes de crear el siguiente).
  await deleteFreeEvent(noDate.id);
  const current = await getCurrentFreeEvent();
  const tool = (await getFreeWebinarTool.execute(
    {},
    { session: { auth: { current: { principalId: staff.id, attributes: { role: "OWNER" } } } } } as never
  )) as { webinar: { id: string; status: string } };
  check("get_free_webinar devuelve el actual", tool.webinar.id === current?.id, { tool: tool.webinar.id, current: current?.id });

  // Todos los de esta prueba ya pasaron (y el de la base de desarrollo, que el
  // reloj cerró en el paso 8): el actual es uno realizado.
  const toolCtx = { session: { auth: { current: { principalId: staff.id, attributes: { role: "OWNER" } } } } } as never;
  if (current && (current.status === "COMPLETED" || current.endedAt)) {
    const before = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: current.id } });
    check("get_free_webinar avisa que ya pasó", (tool as { notice?: string }).notice?.includes("Nuevo evento") === true);
    const upd = (await updateFreeWebinarTool.execute({ startsAtDate: dateIn(40), startsAtTime: "10:00" }, toolCtx)) as {
      ok: boolean;
      error?: string;
      message?: string;
    };
    const deact = (await deactivateFreeWebinarTool.execute({ mode: "reset" }, toolCtx)) as { ok: boolean; error?: string };
    const after = await prisma.freeWebinar.findUniqueOrThrow({ where: { id: current.id } });
    check(
      "update_free_webinar se niega y lo dice",
      upd.ok === false && upd.error === "ended" && Boolean(upd.message?.includes("Nuevo evento")),
      upd
    );
    check("deactivate_free_webinar (reset) también", deact.ok === false && deact.error === "ended", deact);
    check(
      "y el evento sigue igual",
      after.startsAt?.getTime() === before.startsAt?.getTime() && after.headline === before.headline && after.meetUrl === before.meetUrl
    );
  } else {
    check("el actual es uno realizado (para probar la negativa del agente)", false, current?.status);
  }

  console.log("\n11. La trampa de bots del formulario");
  const botRes = await leadsPost(
    new NextRequest("http://localhost/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.78.${run % 250}.1` },
      body: JSON.stringify({
        firstName: "Bot",
        email: `e2e-bot-${run}@example.com`,
        phone: PHONES.bot,
        phoneCountry: "CO",
        source: "web_lead_form",
        notify: true,
        consentData: true,
        tag: "webinar-gratuito",
        hp: "https://spam.example",
      }),
    })
  );
  const botJson = (await botRes.json()) as { ok?: boolean; contactId?: string | null };
  check(
    "contesta «listo» pero no guarda a nadie",
    botRes.status === 200 && botJson.ok === true && botJson.contactId === null &&
      (await prisma.contact.count({ where: { phoneE164: PHONES.bot } })) === 0,
    botJson
  );
};

main()
  .catch((e) => {
    console.error(e);
    failures.push(`excepción: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    await restore().catch((e) => console.error("limpieza:", e));
    console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Eventos como ediciones OK");
    process.exit(failures.length ? 1 : 0);
  });
