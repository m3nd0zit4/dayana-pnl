/**
 * Cuota de correo agotada, de punta a punta, contra la base de DESARROLLO.
 * Resend se simula (nada sale de verdad): `fetch` a api.resend.com responde lo
 * que cada escenario necesita; cualquier otra URL pasa tal cual.
 *
 * Reproduce lo que pasó el 24-25 oct 2026 en producción (1.026 correos
 * fallidos en dos días, 1.030 avisos en la campana) y comprueba que ahora:
 *
 * - con la cuota agotada la pasada PARA tras los envíos que ya estaban en
 *   vuelo, en vez de intentar con toda la cola;
 * - nadie queda sellado: la cola sigue intacta y las siguientes pasadas ni
 *   empiezan mientras la bandera esté vigente (cero llamadas a Resend);
 * - todos esos fallos son UN aviso en la campana, con su contador;
 * - cuando vuelve el cupo, la cola se retoma entera y nadie se queda sin correo;
 * - una dirección que Resend rechaza por formato apaga `notifyEmail` de esa
 *   persona y deja de reintentarse;
 * - un fallo cualquiera (500) NO activa el freno ni apaga a nadie.
 *
 * Crea sus propias filas y las borra al terminar:
 *
 *   bun --env-file=../dayana-pnl/.env scripts/email-quota-e2e.ts
 */
import { prisma } from "@/lib/db";
import { deleteSiteSetting } from "@/lib/crm/site-settings";
import { drainWebinarMail } from "@/lib/crm/webinar-mailer";
import {
  EMAIL_QUOTA_SETTING,
  emailQuotaBlockedUntil,
} from "@/lib/notifications/email-quota";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

// Resend simulado: para que `sendEmail` llegue a `fetch` hay que dejar el modo
// de prueba y poner una clave cualquiera. Inngest queda apuntando a un puerto
// cerrado: los avisos de campana intentan mandar su correo por ahí y fallan en
// el acto, sin tocar internet.
process.env.NOTIFICATIONS_ENABLED = "true";
process.env.NOTIFICATIONS_DRY_RUN = "false";
process.env.RESEND_API_KEY = "re_e2e_clave_falsa";
delete process.env.INNGEST_EVENT_KEY;
delete process.env.INNGEST_SIGNING_KEY;
process.env.INNGEST_DEV = "http://127.0.0.1:9";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

type Mode = "quota" | "ok" | "invalid_for" | "server_error";
let mode: Mode = "quota";
let invalidAddress = "";
let resendCalls = 0;
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.resend.com/emails")) return realFetch(input, init);
  resendCalls += 1;
  const to = (JSON.parse(String(init?.body ?? "{}")) as { to?: string[] }).to?.[0] ?? "";
  if (mode === "ok") return new Response(JSON.stringify({ id: `e2e-${resendCalls}` }), { status: 200 });
  if (mode === "server_error") return new Response("boom", { status: 500 });
  if (mode === "invalid_for" && to === invalidAddress) {
    return new Response(
      JSON.stringify({
        message: "Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.",
        name: "validation_error",
        statusCode: 422,
      }),
      { status: 422 },
    );
  }
  if (mode === "invalid_for") return new Response(JSON.stringify({ id: `e2e-${resendCalls}` }), { status: 200 });
  return new Response(
    JSON.stringify({ message: "You have reached your daily email sending quota.", name: "daily_quota_exceeded", statusCode: 429 }),
    { status: 429 },
  );
}) as typeof fetch;

const run = Date.now();
const t0 = new Date();
const N = 8;
const ids = { webinar: "", contacts: [] as string[] };

const pendingCount = async () =>
  prisma.webinarRegistration.count({ where: { webinarId: ids.webinar, reminder1hSentAt: null } });
const sentCount = async () =>
  prisma.webinarRegistration.count({ where: { webinarId: ids.webinar, reminder1hSentAt: { not: null } } });

const bellRows = async (key: string) =>
  prisma.platformNotification.findMany({
    where: { entityType: "NotificationDeliveryFailure", entityId: key, createdAt: { gte: t0 } },
    select: { id: true, title: true, metadata: true },
  });

const waitFor = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 24) => {
  let v = await fn();
  for (let i = 0; i < tries && !ok(v); i++) {
    await new Promise((r) => setTimeout(r, 500));
    v = await fn();
  }
  return v;
};

const main = async () => {
  await deleteSiteSetting(EMAIL_QUOTA_SETTING);

  const webinar = await prisma.freeWebinar.create({
    data: {
      slug: `e2e-cuota-${run}`,
      headline: `E2E cuota ${run}`,
      learnItems: [],
      status: "OPEN",
      isActive: true,
      startsAt: new Date(Date.now() + 30 * 60_000),
      startsAtHasTime: true,
      meetUrl: "https://meet.google.com/e2e-cuota",
    },
    select: { id: true },
  });
  ids.webinar = webinar.id;

  for (let i = 0; i < N; i++) {
    const c = await prisma.contact.create({
      data: {
        phoneE164: `+1556${String(run).slice(-6)}${i}`,
        firstName: `E2E Cuota ${i}`,
        email: `e2e-cuota-${run}-${i}@example.com`,
        source: "OTHER",
      },
      select: { id: true },
    });
    ids.contacts.push(c.id);
    await prisma.webinarRegistration.create({ data: { webinarId: webinar.id, contactId: c.id } });
  }
  check(`partimos con ${N} inscritos pendientes del recordatorio de 1 h`, (await pendingCount()) === N);

  console.log("\n— Cuota agotada: la pasada PARA");
  mode = "quota";
  resendCalls = 0;
  const first = await drainWebinarMail("1h", 60_000, false, webinar.id);
  check("la pasada avisa que la cuota se agotó", first.quotaExhausted === true && first.reason === "email_quota", first);
  check("no encadena otra pasada", first.pending === false);
  check(`NO intentó con toda la cola (≤ 6 envíos en vuelo, no ${N})`, resendCalls >= 1 && resendCalls <= 6, resendCalls);
  check("nadie queda sellado: toda la cola sigue pendiente", (await pendingCount()) === N, await pendingCount());
  check("queda la bandera compartida", (await emailQuotaBlockedUntil()) !== null);

  console.log("\n— Con la bandera vigente, ni empieza");
  resendCalls = 0;
  const second = await drainWebinarMail("1h", 60_000, false, webinar.id);
  check("la siguiente pasada se salta con motivo email_quota", second.skipped === true && second.reason === "email_quota", second);
  check("y no hace NINGUNA llamada a Resend", resendCalls === 0, resendCalls);
  check("la cola sigue intacta", (await pendingCount()) === N);

  console.log("\n— La campana: un solo aviso, no uno por correo");
  const quotaBell = await waitFor(() => bellRows("EMAIL:quota"), (rows) => rows.length >= 1);
  // Seis envíos fallaron casi a la vez; sólo quien activó el freno avisa.
  await new Promise((r) => setTimeout(r, 1500));
  const quotaBellFinal = await bellRows("EMAIL:quota");
  check("hay EXACTAMENTE UN aviso de cuota (no uno por correo ni dos por una carrera)", quotaBell.length >= 1 && quotaBellFinal.length === 1, quotaBellFinal.length);
  check("con un título que dice qué hacer", /cuota/i.test(quotaBellFinal[0]?.title ?? ""), quotaBellFinal[0]?.title);
  const perDelivery = await prisma.platformNotification.count({
    where: { entityType: "NotificationDelivery", eventType: "NOTIFICATION_DELIVERY_FAILED", createdAt: { gte: t0 } },
  });
  check("ya no se crea un aviso por entrega fallida", perDelivery === 0, perDelivery);

  console.log("\n— Vuelve el cupo: se retoma TODA la cola");
  await deleteSiteSetting(EMAIL_QUOTA_SETTING);
  mode = "ok";
  resendCalls = 0;
  const third = await drainWebinarMail("1h", 60_000, false, webinar.id);
  check(`salen los ${N}`, third.sent === N && third.failed === 0, third);
  check("todos quedan sellados", (await sentCount()) === N, await sentCount());
  check("una llamada a Resend por persona (nadie recibe dos)", resendCalls === N, resendCalls);

  console.log("\n— Dirección que Resend rechaza por formato");
  await prisma.webinarRegistration.updateMany({ where: { webinarId: webinar.id }, data: { reminder1hSentAt: null } });
  const badContactId = ids.contacts[0];
  const bad = await prisma.contact.findUniqueOrThrow({ where: { id: badContactId }, select: { email: true } });
  invalidAddress = bad.email!;
  mode = "invalid_for";
  resendCalls = 0;
  const r4 = await drainWebinarMail("1h", 60_000, false, webinar.id);
  check("sale el resto y falla sólo esa persona", r4.sent === N - 1 && r4.failed === 1, r4);
  const badAfter = await prisma.contact.findUniqueOrThrow({ where: { id: badContactId }, select: { notifyEmail: true } });
  check("se apaga notifyEmail de esa persona (como con un rebote)", badAfter.notifyEmail === false);
  check("no se activa el freno de cuota por esto", (await emailQuotaBlockedUntil()) === null);
  resendCalls = 0;
  const r5 = await drainWebinarMail("1h", 60_000, false, webinar.id);
  check("en la siguiente pasada ya no se le reintenta", resendCalls === 0, { resendCalls, r5 });

  console.log("\n— Correo SUELTO (no barrido): una errata NO silencia al comprador");
  // La confirmación de pago, la invitación al portal y el código de pago no
  // pasan por el mailer masivo. Apagar `notifyEmail` por una errata en el
  // checkout dejaría a ese comprador sin ningún correo posterior, en silencio.
  const { dispatchAndRecord } = await import("@/lib/notifications/dispatch");
  const buyerId = ids.contacts[5];
  const buyer = await prisma.contact.findUniqueOrThrow({ where: { id: buyerId }, select: { email: true } });
  invalidAddress = buyer.email!;
  mode = "invalid_for";
  const bad422 = await dispatchAndRecord({
    contactId: buyerId,
    channel: "EMAIL",
    templateKey: "payment_confirmation",
    subject: "Tu pago",
    html: "<p>pago</p>",
    text: "pago",
    body: "pago",
  });
  check("el correo de pago falla por la dirección", bad422.result.status === "FAILED", bad422.result);
  const buyerAfter = await prisma.contact.findUniqueOrThrow({ where: { id: buyerId }, select: { notifyEmail: true } });
  check("pero NO se apaga notifyEmail de quien pagó", buyerAfter.notifyEmail === true);
  mode = "ok";
  const later = await dispatchAndRecord({
    contactId: buyerId,
    channel: "EMAIL",
    templateKey: "payment_confirmation",
    subject: "Tu pago",
    html: "<p>pago</p>",
    text: "pago",
    body: "pago",
  });
  check("y cuando corrigen la dirección, su siguiente correo SÍ sale", later.result.status === "SENT", later.result);

  console.log("\n— Correo suelto que falla por cuota con el bloqueo ya activo");
  const { markEmailQuotaExhausted } = await import("@/lib/notifications/email-quota");
  await deleteSiteSetting(EMAIL_QUOTA_SETTING);
  await markEmailQuotaExhausted();
  mode = "quota";
  const lost = await dispatchAndRecord({
    contactId: buyerId,
    channel: "EMAIL",
    templateKey: "payment_confirmation",
    subject: "Tu pago",
    html: "<p>pago</p>",
    text: "pago",
    body: "pago",
  });
  check("el correo de pago falla (el bloqueo no lo frena: se intenta siempre)", lost.result.status === "FAILED", lost.result);
  const lostBell = await waitFor(() => bellRows("EMAIL:quota:payment_confirmation"), (r) => r.length >= 1);
  check("y SÍ avisa, agrupado por plantilla, aunque el apagón ya estuviera avisado", lostBell.length === 1, lostBell.length);
  check("el aviso dice que no se reintenta solo", /importante/i.test(lostBell[0]?.title ?? ""), lostBell[0]?.title);
  await dispatchAndRecord({
    contactId: buyerId,
    channel: "EMAIL",
    templateKey: "webinar_reminder_1h",
    subject: "Recordatorio",
    html: "<p>r</p>",
    text: "r",
    body: "r",
  });
  await new Promise((r) => setTimeout(r, 1200));
  check(
    "un recordatorio del webinar NO duplica el aviso (ya lo cubre el del apagón)",
    (await bellRows("EMAIL:quota:webinar_reminder_1h")).length === 0,
  );

  console.log("\n— La bandera: valor corrupto, concurrencia y ventana de silencio");
  const { setSiteSetting } = await import("@/lib/crm/site-settings");
  await setSiteSetting(EMAIL_QUOTA_SETTING, "x");
  check("con un valor que no es fecha, el freno no se queda ciego: avisa y se repara", (await markEmailQuotaExhausted()) === true && (await emailQuotaBlockedUntil()) !== null);
  await deleteSiteSetting(EMAIL_QUOTA_SETTING);
  const racers = await Promise.all(Array.from({ length: 8 }, () => markEmailQuotaExhausted()));
  check("ocho activaciones a la vez: exactamente UNA avisa", racers.filter(Boolean).length === 1, racers);
  await setSiteSetting(EMAIL_QUOTA_SETTING, new Date(Date.now() - 2 * 3600_000).toISOString());
  check("el sondeo horario que vuelve a fallar renueva SIN avisar otra vez (mismo apagón)", (await markEmailQuotaExhausted()) === false && (await emailQuotaBlockedUntil()) !== null);
  await setSiteSetting(EMAIL_QUOTA_SETTING, new Date(Date.now() - 5 * 3600_000).toISOString());
  check("pasadas 4 h sin bloqueo, el siguiente SÍ es otro apagón y avisa", (await markEmailQuotaExhausted()) === true);

  console.log("\n— Con el bloqueo puesto: el barrido espera, lo manual prueba");
  mode = "ok";
  await deleteSiteSetting(EMAIL_QUOTA_SETTING);
  await markEmailQuotaExhausted();
  await prisma.webinarRegistration.updateMany({ where: { webinarId: webinar.id }, data: { reminder1hSentAt: null, linkEmailSentAt: null } });
  resendCalls = 0;
  const cronLink = await drainWebinarMail("link", 60_000, false, webinar.id);
  check("el barrido automático del enlace espera (cero llamadas)", cronLink.skipped === true && cronLink.reason === "email_quota" && resendCalls === 0, { cronLink, resendCalls });
  const bumpedLink = await drainWebinarMail("link", 60_000, false, webinar.id, true);
  check("guardar el enlace de la reunión SÍ prueba y envía aunque haya bloqueo", bumpedLink.sent > 0 && resendCalls > 0, { bumpedLink, resendCalls });
  resendCalls = 0;
  const manual = await drainWebinarMail("1h", 60_000, true, webinar.id);
  check("un reenvío manual del recordatorio también prueba", manual.sent > 0 && resendCalls > 0, { manual, resendCalls });
  await deleteSiteSetting(EMAIL_QUOTA_SETTING);

  console.log("\n— Un fallo cualquiera NO frena ni apaga a nadie, y se agrupa en la campana");
  mode = "server_error";
  let anyQuota = false;
  let totalFailed = 0;
  // Una persona por pasada: así los fallos llegan UNO tras otro y se ve la
  // agrupación por plantilla sin la carrera de los envíos en paralelo.
  for (const contactId of [ids.contacts[1], ids.contacts[2], ids.contacts[3]]) {
    await prisma.webinarRegistration.updateMany({ where: { webinarId: webinar.id }, data: { reminder1hSentAt: new Date() } });
    await prisma.webinarRegistration.updateMany({ where: { webinarId: webinar.id, contactId }, data: { reminder1hSentAt: null } });
    const r6 = await drainWebinarMail("1h", 60_000, false, webinar.id);
    totalFailed += r6.failed;
    anyQuota ||= r6.quotaExhausted === true;
    // Se saca de la cola para que la pasada siguiente sólo vea a UNA persona.
    await prisma.webinarRegistration.updateMany({ where: { webinarId: webinar.id, contactId }, data: { reminder1hSentAt: new Date() } });
    await new Promise((r) => setTimeout(r, 800));
  }
  check("un 500 cuenta como fallo normal y no como cuota", totalFailed === 3 && !anyQuota, { totalFailed, anyQuota });
  check("no activa el freno", (await emailQuotaBlockedUntil()) === null);
  const stillOn = await prisma.contact.findMany({ where: { id: { in: [ids.contacts[1], ids.contacts[2], ids.contacts[3]] } }, select: { notifyEmail: true } });
  check("no apaga notifyEmail de nadie", stillOn.every((c) => c.notifyEmail === true));
  const otherBell = await waitFor(() => bellRows("EMAIL:webinar_reminder_1h"), (rows) => rows.length >= 1);
  const otherCount = (otherBell[0]?.metadata as { count?: number } | null)?.count ?? 1;
  check("tres fallos seguidos de la misma plantilla son UN aviso con contador 3", otherBell.length === 1 && otherCount === 3, { filas: otherBell.length, contador: otherCount });
};

const cleanup = async () => {
  globalThis.fetch = realFetch;
  await deleteSiteSetting(EMAIL_QUOTA_SETTING).catch(() => undefined);
  await prisma.notificationDelivery.deleteMany({ where: { contactId: { in: ids.contacts } } });
  await prisma.platformNotification.deleteMany({
    where: {
      createdAt: { gte: t0 },
      OR: [
        { entityType: "NotificationDeliveryFailure" },
        { entityType: "NotificationDelivery", eventType: "NOTIFICATION_DELIVERY_FAILED" },
      ],
    },
  });
  if (ids.webinar) await prisma.freeWebinar.deleteMany({ where: { id: ids.webinar } });
  await prisma.contact.deleteMany({ where: { id: { in: ids.contacts } } });
};

main()
  .catch((e) => {
    console.error(e);
    failures.push(`excepción: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("limpieza:", e));
    await prisma.$disconnect();
    console.log(failures.length ? `\n❌ ${failures.length} fallo(s):\n - ${failures.join("\n - ")}` : "\n✅ Todo en orden");
    process.exit(failures.length ? 1 : 0);
  });
