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
 * 5. «La IA responde siempre»: la clienta, el número personal y un favorito
 *    pasan todas las reglas (la vuelta llega hasta el modelo: aquí, sin clave,
 *    `no_model_key`); una crisis la sigue callando; apagado, la clienta vuelve
 *    a ser de Dayana.
 */
import { prisma } from "@/lib/db";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { setAiAlways } from "@/lib/crm/whatsapp-autoreply";
import { ignoreNumbers, unignoreNumber } from "@/lib/crm/whatsapp-ignored-numbers";
import { runWhatsAppAi } from "@/lib/crm/whatsapp-agent/run";
import { getChat } from "@/lib/crm/whatsapp-agent/workspace";
import { computeSegment } from "@/lib/crm/whatsapp-agent/segment-store";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
// Sin clave del modelo: una vuelta que pasa todas las reglas termina en
// `no_model_key` (no se llama a Gemini ni se envía nada).
delete process.env.GEMINI_API_KEY;

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

    console.log("\n5. «La IA responde siempre»");
    const reached = (r: Awaited<ReturnType<typeof lastRun>>) => r?.status === "SKIPPED" && r.reason === "no_model_key";
    await setAiAlways(client.id, true, null);
    const cv = await getChat(client.id);
    check("el chat lo muestra, en modo IA", cv?.aiAlways === true && cv.aiMode === "AUTO", { aiAlways: cv?.aiAlways, aiMode: cv?.aiMode });
    await runWhatsAppAi({ conversationId: client.id, triggerMessageId: client.messages[0].externalMessageId! });
    const r5 = await lastRun(client.id);
    check("la clienta pasa todas las reglas (llega al modelo)", reached(r5), r5 && { status: r5.status, reason: r5.reason });

    await setAiAlways(family.id, true, null);
    await runWhatsAppAi({ conversationId: family.id, triggerMessageId: family.messages[0].externalMessageId! });
    const r6 = await lastRun(family.id);
    check("el número personal también", reached(r6), r6 && { status: r6.status, reason: r6.reason });

    await prisma.conversation.update({ where: { id: sticky.id }, data: { priorityAt: new Date() } });
    await setAiAlways(sticky.id, true, null);
    const sv = await prisma.conversation.findUniqueOrThrow({ where: { id: sticky.id }, select: { priorityAt: true, aiModeOverride: true } });
    check("encenderlo quita el favorito y el modo elegido a mano", !sv.priorityAt && sv.aiModeOverride === null, sv);
    await prisma.conversation.update({ where: { id: sticky.id }, data: { priorityAt: new Date() } });
    await runWhatsAppAi({ conversationId: sticky.id, triggerMessageId: sticky.messages[0].externalMessageId! });
    const r7 = await lastRun(sticky.id);
    check("un favorito con «responde siempre» pasa", reached(r7), r7 && { status: r7.status, reason: r7.reason });

    await prisma.conversation.update({
      where: { id: family.id },
      data: { aiPausedAt: new Date(), aiPausedReason: "escalation", escalationCategory: "clinical", escalationSeverity: "urgent", escalationReason: "crisis" },
    });
    await runWhatsAppAi({ conversationId: family.id, triggerMessageId: family.messages[0].externalMessageId! });
    const r8 = await lastRun(family.id);
    check("una crisis la sigue callando", r8?.status === "SKIPPED" && r8.reason === "paused", r8 && { status: r8.status, reason: r8.reason });
    check("…y encenderlo no levanta la crisis", (await setAiAlways(family.id, true, null)).stillPaused);

    await setAiAlways(client.id, false, null);
    check("apagado: el chat ya no lo muestra", (await getChat(client.id))?.aiAlways === false);
    await runWhatsAppAi({ conversationId: client.id, triggerMessageId: client.messages[0].externalMessageId! });
    const r9 = await lastRun(client.id);
    check("apagado: la clienta vuelve a ser de Dayana", r9?.status === "SKIPPED" && r9.reason === "customer", r9 && { status: r9.status, reason: r9.reason });
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
