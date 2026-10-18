/**
 * Sesiones pagadas (17-oct, Jesús con 6 sesiones): se ligan al chat por el
 * enlace de Meet que Dayana le mandó, no reciben el recordatorio de la llamada
 * gratis, y si a los 12 minutos solo Dayana está en Meet, la persona recibe UN
 * mensaje para reagendar. Contra la base de DESARROLLO, sin Google (calendario y
 * Meet simulados) y sin enviar nada de verdad.
 *
 *   bun scripts/whatsapp-no-show-e2e.ts   (también en `bun run e2e:whatsapp`)
 */
import { prisma } from "@/lib/db";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { MeetConference } from "@/lib/google/meet";
import { sendDueReminders, syncAppointments } from "@/lib/crm/whatsapp-agent/appointments";
import { setNoShowDepsForTests, sweepSessionNoShows } from "@/lib/crm/whatsapp-agent/no-show";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const run = Date.now();
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const code = () => `${letters(3)}-${letters(4)}-${letters(3)}`;
const MEET = { jesus: code(), next: code(), joined: code(), absent: code(), group: code() };
const url = (c: string) => `https://meet.google.com/${c}`;
const THREAD = { jesus: `52155${String(run).slice(-8)}`, groupA: `57300${String(run).slice(-7)}1`, groupB: `57300${String(run).slice(-7)}2` };

const ev = (id: string, summary: string, minutesFromNow: number, meet: string, minutes = 60): CalendarEvent => {
  const start = new Date(Date.now() + minutesFromNow * 60_000);
  return {
    id: `e2e-noshow-${run}-${id}`,
    summary,
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + minutes * 60_000).toISOString() },
    hangoutLink: url(meet),
  };
};

const main = async () => {
  const conv = async (thread: string, name: string) =>
    prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: thread, metaAccountId: "test-phone-id", participantName: name, lastInboundAt: new Date(), lastMessageAt: new Date() },
    });
  const jesus = await conv(THREAD.jesus, "JRB prueba");
  const groupA = await conv(THREAD.groupA, "Grupo A prueba");
  const groupB = await conv(THREAD.groupB, "Grupo B prueba");
  // Las invitaciones que Dayana mandó desde el celular (ecos).
  const invite = (conversationId: string, title: string, meet: string) =>
    prisma.conversationMessage.create({
      data: {
        conversationId,
        direction: "OUTBOUND",
        isEcho: true,
        status: "READ",
        body: `${title}\nSábado, 17 de octubre · 9:00 – 10:00pm\nInformación para unirse con Google Meet\nEnlace de la videollamada: ${url(meet)}`,
      },
    });
  await invite(jesus.id, "3.6 jesus terapia de reprogramacion neuronal", MEET.jesus);
  await invite(jesus.id, "4.6 jesus terapia de reprogramacion neuronal", MEET.next);
  await invite(jesus.id, "5.6 jesus terapia", MEET.joined);
  await invite(jesus.id, "6.6 jesus terapia", MEET.absent);
  await invite(groupA.id, "2.6 grupo", MEET.group);
  await invite(groupB.id, "2.6 grupo", MEET.group);

  const events = [
    ev("now", "3.6 jesus terapia de rerpogramacion neuronal", -14, MEET.jesus),
    ev("tomorrow", "4.6 jesus terapia de reprogramacion neuronal", 24 * 60, MEET.next),
    ev("joined", "5.6 jesus terapia", -13, MEET.joined),
    ev("absent", "6.6 jesus terapia", -13, MEET.absent),
    ev("group", "2.6 Curso grupo prueba", -13, MEET.group),
  ];
  const row = (id: string) => prisma.calendarAppointment.findUniqueOrThrow({ where: { eventId: `e2e-noshow-${run}-${id}` } });

  try {
    console.log("\n1. Las sesiones sin número se ligan por el enlace de Meet");
    const first = await syncAppointments({ events, patchTitle: async () => undefined });
    check("dice qué chats se ligaron por Meet (el reloj recalcula su estado)", first.meetLinkedChats.includes(jesus.id), first);
    for (const id of first.meetLinkedChats) await computeSegment(id);
    const now = await row("now");
    check("«3.6 jesus…»: sesión 3/6, ligada a su chat por Meet", now.sessionsLabel === "3/6" && now.conversationId === jesus.id && now.matchState === "meet", now);
    check("el enlace mandado a dos chats (grupo) no se liga a nadie", (await row("group")).conversationId === null);
    const again = await syncAppointments({ events, patchTitle: async () => undefined });
    check("la siguiente lectura del calendario la deja ligada", (await row("now")).conversationId === jesus.id, again);
    const dossier = await prisma.whatsAppDossier.findUnique({ where: { conversationId: jesus.id }, select: { segment: true, stage: true } });
    check("Jesús ya es clienta/cliente (sesión de paquete)", dossier?.segment === "client", dossier);

    console.log("\n2. Sin recordatorio de 24 h para una sesión (es para la llamada gratis)");
    await sendDueReminders();
    const reminder = await prisma.conversationMessage.findFirst({ where: { source: `recordatorio:e2e-noshow-${run}-tomorrow` } });
    check("la sesión de mañana no recibe recordatorio", !reminder, reminder?.body);

    console.log("\n3. A los 12 minutos, con solo Dayana en Meet: un mensaje para reagendar");
    const start = (id: string) => events.find((e) => e.id.endsWith(id))!.start!.dateTime!;
    const meeting = (startIso: string, people: MeetConference["participants"]): MeetConference => ({ startTime: startIso, endTime: null, participants: people });
    const DAYANA = { user: "users/111", displayName: "Dayana Beltrán", joinedAt: new Date().toISOString(), leftAt: null };
    const sent: { text: string; vars: unknown; source: string }[] = [];
    setNoShowDepsForTests({
      dayana: { id: "111", name: "Dayana Beltrán" },
      conference: async (meetUrl) => {
        if (meetUrl.includes(MEET.jesus)) return meeting(start("now"), [DAYANA]);
        if (meetUrl.includes(MEET.joined)) return meeting(start("joined"), [DAYANA, { user: null, displayName: "Jesús", joinedAt: new Date().toISOString(), leftAt: null }]);
        return null; // «absent»: nadie abrió la reunión
      },
      send: async (input) => {
        sent.push({ text: input.text, vars: input.vars, source: input.source });
        return { status: "sent" } as Awaited<ReturnType<typeof import("@/lib/crm/whatsapp-outbound").sendWhatsAppToRecipient>>;
      },
    });
    const config = await getWhatsAppAiConfig();
    const cfg = { ...config, noShow: { ...config.noShow, enabled: true, afterMin: 12 } };
    const r1 = await sweepSessionNoShows(cfg);
    check("sale un mensaje (Jesús) y la otra persona sí entró", r1.sent === 1 && r1.joined === 1 && sent.length === 1, { r1, sent });
    check("es para reagendar, con la hora", /reagendar/i.test(sent[0]?.text ?? "") && /p\.\sm\./.test(sent[0]?.text ?? ""), sent[0]);
    check("queda marcado una sola vez", (await row("now")).noShowState === "sent" && (await row("joined")).noShowState === "joined");
    check("el del grupo (sin chat) no se mira", (await row("group")).noShowState === null);
    const r2 = await sweepSessionNoShows(cfg);
    check("una segunda pasada no manda otro", r2.sent === 0 && sent.length === 1, r2);
    check("si Dayana no abrió la reunión, se espera", (await row("absent")).noShowState === null);
    const r3 = await sweepSessionNoShows(cfg, new Date(Date.now() + 25 * 60_000));
    check("y pasado el tiempo se deja, sin mensaje", r3.gaveUp === 1 && (await row("absent")).noShowState === "dayana_absent" && sent.length === 1, r3);

    const off = await sweepSessionNoShows({ ...cfg, noShow: { ...cfg.noShow, enabled: false } });
    check("apagado en Ajustes no hace nada", off.checked === 0, off);
  } finally {
    setNoShowDepsForTests(null);
    await prisma.calendarAppointment.deleteMany({ where: { eventId: { startsWith: `e2e-noshow-${run}` } } });
    await prisma.conversation.deleteMany({ where: { id: { in: [jesus.id, groupA.id, groupB.id] } } });
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Sesiones sin asistir OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
