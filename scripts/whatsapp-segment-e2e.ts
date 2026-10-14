/**
 * Quién es quién (segmentos) contra la base de DESARROLLO, sin IA.
 *
 *   bun scripts/whatsapp-segment-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Dice que pagó por transferencia (solo consta en el chat, sin que Dayana lo
 *    confirme): sigue con la IA y queda por revisar, con la cita.
 * 2. Dayana dice «no es clienta»: ya conversó, sin revisar. «Es clienta»: clienta.
 * 3. Solo recibió la invitación masiva y dio las gracias: nueva.
 * 4. Número personal: no se atiende.
 * 5. Estados después de la llamada gratis: la tuvo (Dayana cierra) o no contestó.
 */
import { prisma } from "@/lib/db";
import { ignoreNumbers, unignoreNumber } from "@/lib/crm/whatsapp-ignored-numbers";
import { computeSegment, listSegmentReview, markClient } from "@/lib/crm/whatsapp-agent/segment-store";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const PAID = "573000006611";
const INVITED = "573000006612";
const FAMILY = "573000006613";
const CALLED = "573000006614";
const MISSED = "573000006615";
const THREADS = [PAID, INVITED, FAMILY, CALLED, MISSED];

type Line = { dir: "INBOUND" | "OUTBOUND"; body: string; source?: string };

const chat = async (thread: string, lines: Line[]) =>
  prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: thread,
      metaAccountId: "e2e",
      lastMessageAt: new Date(),
      messages: {
        create: lines.map((l, i) => ({
          direction: l.dir,
          status: "DELIVERED" as const,
          externalMessageId: `wamid.e2e.seg.${thread}.${i}`,
          body: l.body,
          source: l.source ?? null,
          sentAt: new Date(Date.now() - (lines.length - i) * 3600_000),
        })),
      },
    },
  });

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await prisma.calendarAppointment.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { eventId: { startsWith: "e2e-stage-" } }] } });
  await prisma.whatsAppDossier.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await unignoreNumber(FAMILY);
};

const main = async () => {
  await cleanup();
  try {
    console.log("\n1. Pagó por transferencia");
    const paid = await chat(PAID, [
      { dir: "INBOUND", body: "Hola Dayana, quiero empezar el paquete" },
      { dir: "OUTBOUND", body: "Claro, te paso los datos" },
      { dir: "INBOUND", body: "Listo, ya te transferí. Aquí está el comprobante" },
    ]);
    const v1 = await computeSegment(paid.id);
    check("no es clienta todavía (la IA la sigue atendiendo), por revisar", v1?.segment === "returning_lead" && v1.review, v1);
    const review = await listSegmentReview();
    const item = review.find((r) => r.conversationId === paid.id);
    check("aparece en «por revisar» con la cita", Boolean(item?.evidence.some((e) => /transfer/i.test(e.quote))), item);

    console.log("\n2. La marca de Dayana");
    const v2 = await markClient(paid.id, false, null);
    check("«no es clienta»: ya conversó, sin revisar", v2?.segment === "returning_lead" && !v2.review, v2);
    check("estado: conversando", v2?.stage === "conversando", v2);
    const v3 = await markClient(paid.id, true, null);
    check("«es clienta»: clienta", v3?.segment === "client" && v3.source === "manual", v3);
    check("estado: ya fue clienta (nada en curso)", v3?.stage === "clienta_pasada", v3);

    console.log("\n3. Solo la invitación masiva");
    const invited = await chat(INVITED, [
      { dir: "OUTBOUND", body: "Te invito a la masterclass gratuita del domingo", source: "bulk:e2e" },
      { dir: "INBOUND", body: "Gracias 🙏" },
      { dir: "INBOUND", body: "Hola, quiero saber de las sesiones" },
    ]);
    const v4 = await computeSegment(invited.id);
    check("nueva", v4?.segment === "new_lead", v4);

    console.log("\n4. Número personal");
    await ignoreNumbers([`+${FAMILY}`], "manual");
    const family = await chat(FAMILY, [{ dir: "INBOUND", body: "Hija, ¿vienes a almorzar?" }]);
    const v5 = await computeSegment(family.id);
    check("no se atiende", v5?.segment === "ignored", v5);
    check("estado: personal", v5?.stage === "personal", v5);

    console.log("\n5. Después de la llamada gratis");
    const lead = [
      { dir: "INBOUND" as const, body: "Hola, tengo mucha ansiedad" },
      { dir: "OUTBOUND" as const, body: "Te entiendo. ¿Agendamos la llamada gratis?" },
      { dir: "INBOUND" as const, body: "Sí, el jueves" },
    ];
    const pastCall = (thread: string, conversationId: string, callOutcome: string | null) => {
      const start = new Date(Date.now() - 26 * 3600_000);
      return prisma.calendarAppointment.create({
        data: {
          eventId: `e2e-stage-${thread}`,
          startsAt: start,
          endsAt: new Date(start.getTime() + 15 * 60_000),
          title: `0/0 Lucía +${thread}`,
          name: "Lucía",
          phone: thread,
          sessionsLabel: "0/0",
          conversationId,
          status: "active",
          matchState: "phone",
          callOutcome,
          callOutcomeAt: callOutcome ? new Date() : null,
        },
      });
    };
    const called = await chat(CALLED, lead);
    await pastCall(CALLED, called.id, "answered");
    const v6 = await computeSegment(called.id);
    check("la tuvo: «tuvo la llamada» (Dayana cierra)", v6?.segment === "after_call" && v6.stage === "tuvo_llamada", v6);
    const missed = await chat(MISSED, lead);
    await pastCall(MISSED, missed.id, "no_answer");
    const v7 = await computeSegment(missed.id);
    check("no contestó: «no contestó» (se le ofrece otra hora)", v7?.segment === "returning_lead" && v7.stage === "no_contesto", v7);
    const saved = await prisma.whatsAppDossier.findUnique({ where: { conversationId: missed.id }, select: { stage: true } });
    check("el estado queda guardado en la ficha", saved?.stage === "no_contesto", saved);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Segmentos: todo bien");
};

main();
