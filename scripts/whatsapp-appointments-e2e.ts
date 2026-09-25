/**
 * Citas del calendario ligadas a cada persona y recordatorio de 24 h. Contra la
 * base de DESARROLLO, con un calendario simulado (no se llama a Google) y
 * WhatsApp en modo prueba.
 *
 *   bun scripts/whatsapp-appointments-e2e.ts   (también en `bun run e2e:whatsapp`)
 */
import { prisma } from "@/lib/db";
import type { CalendarEvent } from "@/lib/google/calendar";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { appointmentsFor, isReminderDue, sendDueReminders, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { approvedSlotsFor, clientContext } from "@/lib/crm/whatsapp-agent/brain";
import { approveProposal, proposeForApproval } from "@/lib/crm/whatsapp-agent/approvals";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const LAURA = "+573000008801";
const ANA1 = "+573000008802";
const ANA2 = "+573000008803";
const PEDRO = "+573000008804";

const ev = (id: string, summary: string, hoursFromNow: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  return {
    id: `e2e-${run}-${id}`,
    summary,
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + 60 * 60_000).toISOString() },
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    ...extra,
  };
};

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  const surnames = `Prueba${run}`;
  for (const [phone, firstName] of [
    [LAURA, "Laurita"],
    [ANA1, "Anabella"],
    [ANA2, "Anabella"],
    [PEDRO, "Pedrito"],
  ] as const) {
    await prisma.contact.upsert({
      where: { phoneE164: phone },
      create: { phoneE164: phone, firstName, lastName: surnames, notifyWhatsapp: true, searchText: `${firstName} ${surnames}`.toLowerCase() },
      update: { firstName, lastName: surnames, searchText: `${firstName} ${surnames}`.toLowerCase(), notifyWhatsapp: true },
    });
  }
  // Pedro escribió hace 1 h (ventana abierta: el recordatorio va como texto).
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: PEDRO.slice(1) } });
  await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: PEDRO.slice(1), metaAccountId: "test-phone-id", participantName: "Pedrito", lastInboundAt: new Date(Date.now() - 3600_000), lastMessageAt: new Date() },
  });

  const events = [
    ev("laura", `3/6 Laurita ${surnames}`, 24), // sin número, una sola persona → se completa
    ev("ana", `Anabella ${surnames}`, 48), // dos personas → pregunta a Dayana
    ev("pedro", `0/0 Pedrito ${surnames} ${PEDRO}`, 24), // ya trae el número
    ev("disp", "Disponible", 30), // bloque de disponibilidad → no es cita
    ev("libre", "Almuerzo", 26, { transparency: "transparent" }), // libre → no es cita
  ];
  const patched: Record<string, string> = {};
  const patchTitle = async (id: string, summary: string) => {
    patched[id] = summary;
  };

  console.log("\n1. Leer el calendario y ligar cada cita con su persona");
  const r1 = await syncAppointments({ events, patchTitle });
  check("3 citas (sin «Disponible» ni lo libre)", r1.seen === 3, r1);
  const laura = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: events[0].id } });
  check("Laura: una sola persona → se le agregó el número al título", laura.matchState === "auto" && patched[events[0].id]?.endsWith(`+${LAURA.slice(1)}`), { state: laura.matchState, title: patched[events[0].id] });
  check("Laura: sesión 3/6 leída del título", laura.sessionsLabel === "3/6", laura.sessionsLabel);
  const ana = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: events[1].id } });
  check("Ana: dos personas con ese nombre → queda para que Dayana elija", ana.matchState === "ambiguous" && Array.isArray(ana.candidates) && (ana.candidates as unknown[]).length === 2, ana.matchState);
  check("Ana: no se tocó el título", !patched[events[1].id]);
  const pedro = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: events[2].id } });
  check("Pedro: el título ya traía el número", pedro.matchState === "phone" && Boolean(pedro.contactId), pedro.matchState);

  console.log("\n2. La IA sabe quién tiene cita y en qué etapa está");
  const ctx = await clientContext(pedro.contactId, PEDRO.slice(1));
  check("dice que tiene la llamada gratis agendada", Boolean(ctx?.includes("llamada gratis")), ctx);
  const found = await appointmentsFor({ phone: LAURA.slice(1) });
  check("se encuentra la próxima cita por el número", found.next?.id === laura.id);

  console.log("\n3. Recordatorio de 24 h, una sola vez");
  check("la regla 23–25 h", isReminderDue(new Date(Date.now() + 24 * 3600_000), new Date()) && !isReminderDue(new Date(Date.now() + 30 * 3600_000), new Date()));
  // Plantilla de recordatorio aprobada (para Laura, que nunca escribió).
  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: "cita_recordatorio", locale: "es" } },
    create: {
      key: "cita_recordatorio",
      title: "Cita: recordatorio 24 h",
      body: "Hola {{nombre}}, te recuerdo tu cita de {{servicio}} mañana {{fecha}} a las {{hora}}. Enlace: {{enlace}} Responde SÍ para confirmar o escríbeme si necesitas cambiarla.",
      metaTemplateName: "cita_recordatorio",
      metaTemplateLang: "es",
      metaApprovalStatus: "APPROVED",
      metaCategory: "UTILITY",
      metaBody: "Hola {{1}}, te recuerdo tu cita de {{2}} mañana {{3}} a las {{4}}. Enlace: {{5}} Responde SÍ para confirmar o escríbeme si necesitas cambiarla.",
      metaVarNames: ["nombre", "servicio", "fecha", "hora", "enlace"],
    },
    update: { metaApprovalStatus: "APPROVED" },
  });
  const r2 = await sendDueReminders();
  check("salen 2 recordatorios (Laura y Pedro; Ana es en 48 h)", r2.sent === 2, r2);
  const r3 = await sendDueReminders();
  check("una segunda pasada no manda nada", r3.sent === 0 && r3.failed === 0, r3);
  const pedroMsg = await prisma.conversationMessage.findFirst({ where: { source: `recordatorio:${events[2].id}` } });
  check("Pedro (escribió hace poco) lo recibe como texto", Boolean(pedroMsg?.body?.includes("Te recuerdo")), pedroMsg?.body);
  const lauraMsg = await prisma.conversationMessage.findFirst({ where: { source: `recordatorio:${events[0].id}` } });
  check("Laura (nunca escribió) lo recibe con la plantilla", Boolean(lauraMsg?.body?.startsWith("Hola Laurita, te recuerdo tu cita")), lauraMsg?.body);

  console.log("\n4. Si la cita desaparece del calendario, se cancela");
  const r4 = await syncAppointments({ events: [events[2]], patchTitle });
  const lauraAfter = await prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: events[0].id } });
  check("la de Laura queda cancelada", lauraAfter.status === "cancelled" && r4.cancelled >= 2, { status: lauraAfter.status, r4 });

  console.log("\n5. Dayana aprueba los horarios antes de que se ofrezcan");
  const conv = await prisma.conversation.findFirstOrThrow({ where: { channel: "WHATSAPP", externalThreadId: PEDRO.slice(1) } });
  const at = (h: number) => new Date(Math.floor((Date.now() + h * 3600_000) / 3600_000) * 3600_000).toISOString();
  const options = [
    { startIso: at(50), label: "opción A" },
    { startIso: at(52), label: "opción B" },
    { startIso: at(54), label: "opción C" },
  ];
  const aiRun = await prisma.whatsAppAiRun.create({ data: { conversationId: conv.id, status: "THINKING" } });
  await proposeForApproval({
    runId: aiRun.id,
    conversationId: conv.id,
    name: "Pedrito",
    proposal: { kind: "slots", message: "¡Qué bueno! Tengo estas horas:\n{{HORARIOS}}\n¿Cuál te sirve?", slots: { service: "Llamada gratis", options } },
  });
  check("antes de aprobar no hay horas ofrecidas", (await approvedSlotsFor(conv.id)).length === 0);
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "OWNER" }, select: { id: true } });
  const added = { startIso: at(70), label: "opción D (de Dayana)" };
  let emptyRejected = false;
  try {
    await approveProposal({ runId: aiRun.id, conversationId: conv.id, staffId: staff.id, slots: [] });
  } catch {
    emptyRejected = true;
  }
  check("sin ninguna hora no deja enviar", emptyRejected);
  await approveProposal({ runId: aiRun.id, conversationId: conv.id, staffId: staff.id, slots: [options[0], options[2], added] });
  const sentRun = await prisma.whatsAppAiRun.findUniqueOrThrow({ where: { id: aiRun.id }, select: { status: true, proposal: true } });
  const sentId = (sentRun.proposal as { sentMessageId?: string }).sentMessageId;
  const sentMsg = sentId ? await prisma.conversationMessage.findFirst({ where: { OR: [{ id: sentId }, { externalMessageId: sentId }] } }) : null;
  const body = sentMsg?.body ?? "";
  check(
    "a la persona le llegan exactamente las horas que dejó Dayana",
    sentRun.status === "APPROVED" && body.includes("• opción A") && body.includes("• opción C") && body.includes("• opción D (de Dayana)") && !body.includes("opción B") && !body.includes("{{HORARIOS}}"),
    { status: sentRun.status, body }
  );
  const approvedNow = await approvedSlotsFor(conv.id);
  check(
    "solo esas se pueden agendar (la que quitó queda fuera)",
    approvedNow.includes(options[0].startIso) && approvedNow.includes(added.startIso) && !approvedNow.includes(options[1].startIso),
    approvedNow
  );

  await prisma.whatsAppAiRun.deleteMany({ where: { id: aiRun.id } });
  await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: `e2e-${run}` } } });
  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Citas OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
