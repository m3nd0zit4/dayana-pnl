/**
 * Quién atiende a quién (enrutador) contra la base de DESARROLLO. Sin enviar
 * nada: los casos se resuelven antes de llamar al modelo.
 *
 *   bun scripts/whatsapp-router-e2e.ts   (también dentro de `bun run e2e:whatsapp`)
 *
 * Casos:
 * 1. Una clienta que pagó por transferencia escribe: la IA no contesta
 *    («customer») y le toca a Dayana.
 * 2. Un número personal escribe: la IA no contesta y NO aparece en «Te toca».
 * 3. Un chat con el Copiloto pegado de antes: con el enrutador, una persona
 *    nueva trabaja en el modo de su grupo (IA), y así lo muestra el chat.
 * 4. Dayana toma el chat: queda en «Tú» aunque el grupo diga IA; al soltarlo
 *    vuelve a decidir el grupo.
 */
import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { ignoreNumbers, unignoreNumber } from "@/lib/crm/whatsapp-ignored-numbers";
import { runWhatsAppAi } from "@/lib/crm/whatsapp-agent/run";
import { getChat } from "@/lib/crm/whatsapp-agent/workspace";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const CLIENT = "573000005511";
const FAMILY = "573000005512";
const STICKY = "573000005513";
const THREADS = [CLIENT, FAMILY, STICKY];

const chat = async (thread: string, lines: { dir: "INBOUND" | "OUTBOUND"; body: string }[], aiMode: "AUTO" | "COPILOT" = "AUTO") =>
  prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: thread,
      metaAccountId: "e2e",
      aiMode,
      status: "OPEN",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
      messages: {
        create: lines.map((l, i) => ({
          direction: l.dir,
          status: "DELIVERED" as const,
          externalMessageId: `wamid.e2e.router.${thread}.${i}`,
          body: l.body,
          sentAt: new Date(Date.now() - (lines.length - i) * 60_000),
        })),
      },
    },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
  });

const lastRun = (conversationId: string) =>
  prisma.whatsAppAiRun.findFirst({ where: { conversationId }, orderBy: { queuedAt: "desc" } });

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: { in: THREADS } }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await unignoreNumber(FAMILY);
};

const main = async () => {
  const previous = await getWhatsAppAiConfig();
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  await setWhatsAppAiConfig({
    ...previous,
    defaultMode: "AUTO",
    router: { ...previous.router, enabled: true, modes: { ...previous.router.modes, new_lead: "AUTO", client: "MANUAL", ignored: "MANUAL" } },
  });
  await cleanup();
  try {
    console.log("\n1. Clienta que pagó por transferencia");
    const client = await chat(CLIENT, [
      { dir: "INBOUND", body: "Dayana, ya te transferí, aquí está el comprobante" },
      { dir: "OUTBOUND", body: "Recibí tu pago, bienvenida a tu proceso" },
      { dir: "INBOUND", body: "Hola, ¿cuándo es mi próxima sesión?" },
    ]);
    await runWhatsAppAi({ conversationId: client.id, triggerMessageId: client.messages[0].externalMessageId! });
    const r1 = await lastRun(client.id);
    check("la IA no contesta: es clienta", r1?.status === "SKIPPED" && r1.reason === "customer", r1 && { status: r1.status, reason: r1.reason });
    const c1 = await prisma.conversation.findUniqueOrThrow({ where: { id: client.id }, select: { attentionAt: true } });
    check("le toca a Dayana", Boolean(c1.attentionAt));

    console.log("\n2. Número personal");
    await ignoreNumbers([`+${FAMILY}`], "manual");
    const family = await chat(FAMILY, [{ dir: "INBOUND", body: "Hija, ¿vienes a almorzar el domingo?" }]);
    await runWhatsAppAi({ conversationId: family.id, triggerMessageId: family.messages[0].externalMessageId! });
    const r2 = await lastRun(family.id);
    check("la IA no contesta", r2?.status === "SKIPPED" && r2.reason === "ignored_segment", r2 && { status: r2.status, reason: r2.reason });
    const c2 = await prisma.conversation.findUniqueOrThrow({ where: { id: family.id }, select: { attentionAt: true } });
    check("no aparece en «Te toca»", !c2.attentionAt);

    console.log("\n3. El Copiloto pegado ya no cuenta");
    const sticky = await chat(STICKY, [{ dir: "INBOUND", body: "Hola, quiero información de las sesiones" }], "COPILOT");
    await computeSegment(sticky.id);
    const view = await getChat(sticky.id);
    check("persona nueva en modo IA (el de su grupo)", view?.aiMode === "AUTO", { aiMode: view?.aiMode, segment: view?.segment?.segment });

    console.log("\n4. Dayana toma el chat y lo suelta");
    await prisma.conversation.update({ where: { id: sticky.id }, data: { aiMode: "MANUAL", aiModeOverride: "MANUAL" } });
    check("tomado: «Tú»", (await getChat(sticky.id))?.aiMode === "MANUAL");
    await prisma.conversation.update({ where: { id: sticky.id }, data: { aiMode: "AUTO", aiModeOverride: null } });
    check("soltado: vuelve a decidir el grupo", (await getChat(sticky.id))?.aiMode === "AUTO");
  } finally {
    await cleanup();
    await setWhatsAppAiConfig(previous);
    if (previousEnabled) await prisma.siteSetting.update({ where: { key: "whatsapp.autoreply.enabled" }, data: { value: previousEnabled.value } });
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Enrutador: todo bien");
};

main();
