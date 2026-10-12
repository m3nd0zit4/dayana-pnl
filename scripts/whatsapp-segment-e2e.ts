/**
 * Quién es quién (segmentos) contra la base de DESARROLLO, sin IA.
 *
 *   bun scripts/whatsapp-segment-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Pagó por transferencia (solo consta en el chat): clienta por revisar, con la cita.
 * 2. Dayana dice «no es clienta»: ya conversó, sin revisar. «Es clienta»: clienta.
 * 3. Solo recibió la invitación masiva y dio las gracias: nueva.
 * 4. Número personal: no se atiende.
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
const THREADS = [PAID, INVITED, FAMILY];

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
    check("clienta por revisar", v1?.segment === "client" && v1.review, v1);
    const review = await listSegmentReview();
    const item = review.find((r) => r.conversationId === paid.id);
    check("aparece en «por revisar» con la cita", Boolean(item?.evidence.some((e) => /transfer/i.test(e.quote))), item);

    console.log("\n2. La marca de Dayana");
    const v2 = await markClient(paid.id, false, null);
    check("«no es clienta»: ya conversó, sin revisar", v2?.segment === "returning_lead" && !v2.review, v2);
    const v3 = await markClient(paid.id, true, null);
    check("«es clienta»: clienta", v3?.segment === "client" && v3.source === "manual", v3);

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
