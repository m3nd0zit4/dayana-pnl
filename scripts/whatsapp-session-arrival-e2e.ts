/**
 * Te esperan en la sala (19-oct, pedido de la dueña): a la hora de una sesión
 * pagada con Meet, Dayana recibe un aviso cuando la persona entró y ella no, o
 * cuando la persona escribe que está esperando. Contra la base de DESARROLLO,
 * con Meet simulado y sin enviar nada a la persona.
 *
 *   bun scripts/whatsapp-session-arrival-e2e.ts   (también en `bun run e2e:whatsapp`)
 */
import { prisma } from "@/lib/db";
import type { MeetConference } from "@/lib/google/meet";
import { notifyWaitingFromChat, setArrivalDepsForTests, sweepSessionArrivals } from "@/lib/crm/whatsapp-agent/session-arrival";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";

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
const MEET = { waiting: code(), dayana: code(), later: code() };
const url = (c: string) => `https://meet.google.com/${c}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const conv = await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: `57301${String(run).slice(-7)}`,
      metaAccountId: "test-phone-id",
      participantName: "Perfil prueba",
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
    },
  });
  const other = await prisma.conversation.create({
    data: { channel: "WHATSAPP", externalThreadId: `57302${String(run).slice(-7)}`, metaAccountId: "test-phone-id", participantName: "Otra prueba", lastInboundAt: new Date(), lastMessageAt: new Date() },
  });
  const appt = (id: string, minutesFromNow: number, meet: string | null, extra: { conversationId?: string; sessionsLabel?: string | null; minutes?: number } = {}) => {
    const startsAt = new Date(Date.now() + minutesFromNow * 60_000);
    return prisma.calendarAppointment.create({
      data: {
        eventId: `e2e-arrival-${run}-${id}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + (extra.minutes ?? 60) * 60_000),
        title: `3.6 jesus terapia ${id}`,
        name: "jesus",
        sessionsLabel: extra.sessionsLabel === undefined ? "3/6" : extra.sessionsLabel,
        meetUrl: meet ? url(meet) : null,
        conversationId: extra.conversationId ?? conv.id,
        matchState: "meet",
      },
    });
  };
  const waiting = await appt("waiting", -2, MEET.waiting);
  const withDayana = await appt("dayana", 3, MEET.dayana, { conversationId: other.id });
  await appt("later", 120, MEET.later);
  await appt("free", -1, null, { sessionsLabel: null, minutes: 15 });
  const row = (id: string) => prisma.calendarAppointment.findUniqueOrThrow({ where: { id } });
  const notices = () =>
    prisma.platformNotification.findMany({
      where: { eventType: "WHATSAPP_SESSION_WAITING", entityId: { in: [waiting.id, withDayana.id] } },
      orderBy: { createdAt: "asc" },
      select: { title: true, body: true, entityId: true, href: true },
    });

  const DAYANA = { user: "users/111", displayName: "Dayana Beltrán", joinedAt: new Date().toISOString(), leftAt: null };
  const JESUS = { user: null, displayName: "Jesus R", joinedAt: new Date().toISOString(), leftAt: null };
  const meeting = (people: MeetConference["participants"]): MeetConference => ({ startTime: new Date().toISOString(), endTime: null, participants: people });
  const called: string[] = [];
  setArrivalDepsForTests({
    dayana: { id: "111", name: "Dayana Beltrán" },
    conference: async (meetUrl) => {
      called.push(meetUrl);
      if (meetUrl.includes(MEET.waiting)) return meeting([JESUS]);
      if (meetUrl.includes(MEET.dayana)) return meeting([DAYANA]);
      return null;
    },
  });

  try {
    const config = await getWhatsAppAiConfig();
    const cfg = { ...config, sessionArrival: { enabled: true } };

    console.log("\n1. Meet: la persona entró y Dayana no");
    const r1 = await sweepSessionArrivals(cfg);
    check("mira solo las sesiones de ahora con Meet (no la de dentro de 2 h ni la llamada gratis)", r1.checked === 2 && called.length === 2, { r1, called });
    check("avisa una (Jesús esperando) y la otra ya tiene a Dayana", r1.notified === 1 && r1.dayanaIn === 1, r1);
    check("queda marcada", (await row(waiting.id)).arrivalSource === "meet" && (await row(withDayana.id)).arrivalSource === "dayana_in");
    await sleep(1500);
    const n1 = await notices();
    check(
      "el aviso dice quién, que entró y cómo aparece en Meet",
      n1.length === 1 && n1[0].title === "Jesus te espera en Meet" && /Entró a la sala.*«Jesus R»/.test(n1[0].body ?? "") && n1[0].href === `/admin/whatsapp?conversation=${conv.id}`,
      n1
    );
    const r2 = await sweepSessionArrivals(cfg);
    check("la siguiente pasada no vuelve a avisar ni consulta Meet", r2.checked === 0 && called.length === 2, r2);

    console.log("\n2. El chat: «no me deja entrar»");
    check("«hola» no avisa", !(await notifyWaitingFromChat({ conversationId: conv.id, text: "Hola" })));
    check("recién avisado por Meet: no suena otra vez enseguida", !(await notifyWaitingFromChat({ conversationId: conv.id, text: "ya estoy en la sala" })));
    check(
      "pasados 5 min, «sigo esperando» vuelve a sonar",
      await notifyWaitingFromChat({ conversationId: conv.id, text: "Sigo esperando", now: new Date(Date.now() + 6 * 60_000) })
    );
    check("con Dayana ya en la reunión, igual avisa (puede no ver la solicitud)", await notifyWaitingFromChat({ conversationId: other.id, text: "no me deja entrar" }));
    await sleep(1500);
    const n2 = await notices();
    const chatNotice = n2.find((n) => n.entityId === withDayana.id);
    check("el aviso del chat cita lo que escribió", /«no me deja entrar»/.test(chatNotice?.body ?? "") && /acepta su solicitud/.test(chatNotice?.body ?? ""), n2);
    check("un mensaje viejo que llega tarde no avisa", !(await notifyWaitingFromChat({ conversationId: other.id, text: "estoy esperando", sentAt: new Date(Date.now() - 20 * 60_000), now: new Date(Date.now() + 10 * 60_000) })));
    const lonely = await prisma.conversation.create({
      data: { channel: "WHATSAPP", externalThreadId: `57303${String(run).slice(-7)}`, metaAccountId: "test-phone-id", participantName: "Sin sesión", lastInboundAt: new Date(), lastMessageAt: new Date() },
    });
    check("sin sesión ahora, nada", !(await notifyWaitingFromChat({ conversationId: lonely.id, text: "ya estoy en la sala" })));
    await prisma.conversation.delete({ where: { id: lonely.id } });

    console.log("\n3. Apagado en Ajustes");
    await prisma.calendarAppointment.update({ where: { id: waiting.id }, data: { arrivalNotifiedAt: null, arrivalSource: null } });
    const off = await sweepSessionArrivals({ ...cfg, sessionArrival: { enabled: false } });
    check("no mira nada", off.checked === 0 && (await row(waiting.id)).arrivalNotifiedAt === null, off);
  } finally {
    setArrivalDepsForTests(null);
    const ids = (await prisma.calendarAppointment.findMany({ where: { eventId: { startsWith: `e2e-arrival-${run}` } }, select: { id: true } })).map((a) => a.id);
    await prisma.platformNotification.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.calendarAppointment.deleteMany({ where: { id: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: [conv.id, other.id] } } });
  }
  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Te esperan en la sala OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
