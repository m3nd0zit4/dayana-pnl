/**
 * La IA lee el historial de verdad. Contra la base de DESARROLLO y con Gemini
 * (copiloto: no se envía nada, queda la propuesta).
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-context-e2e.ts
 *
 * Una persona habló con Dayana hace tres meses (chat importado del celular) y
 * hoy vuelve a escribir. Casos:
 * 1. La ficha se arma con todo el chat y guarda de dónde escribe y qué la trae.
 * 2. La IA la trata como persona CON conversación previa, lee lo importado y
 *    la ficha (queda en el rastro de la ejecución).
 * 3. La propuesta no vuelve a preguntar de dónde escribe.
 */
import { prisma } from "@/lib/db";
import { importExportChat } from "@/lib/crm/whatsapp-export-import";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { updateDossier } from "@/lib/crm/whatsapp-agent/dossier";
import { setFreeCallCalendarForTests } from "@/lib/crm/whatsapp-agent/free-call";
import { processNormalizedEvent } from "@/lib/meta/ingest";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
if (!process.env.GEMINI_API_KEY?.trim()) throw new Error("Hace falta GEMINI_API_KEY (la prueba usa la IA de verdad).");

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const PHONE = "+5218112349902";
const THREAD = PHONE.slice(1);

const pad = (n: number) => String(n).padStart(2, "0");
const ago = (days: number, hm: string) => {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}, ${hm}`;
};

const EXPORT = [
  `${ago(95, "10:00")} - Carla: Hola Dayana, soy Carla, te escribo desde Monterrey`,
  `${ago(95, "10:01")} - Carla: Tengo mucha ansiedad desde que me separé, casi no duermo`,
  `${ago(95, "10:20")} - Dayana Beltrán: Hola Carla, te bendigo. ¿Cuánto tiempo más quieres seguir así?`,
  `${ago(95, "10:25")} - Carla: Ya no quiero, estoy cansada`,
  `${ago(95, "10:30")} - Dayana Beltrán: Te invito a una llamada gratis de 15 minutos conmigo para ver cómo te puedo ayudar`,
  `${ago(95, "10:40")} - Carla: La próxima semana te digo, ahorita no puedo`,
].join("\n");

const cleanup = async () => {
  const convs = await prisma.conversation.findMany({ where: { channel: "WHATSAPP", externalThreadId: THREAD }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await prisma.whatsAppAiRun.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppReplyExample.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } });
  await prisma.whatsAppMemory.deleteMany({ where: { phone: THREAD } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
};

const main = async () => {
  const previousConfig = await getWhatsAppAiConfig();
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  const previousEnabled = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.autoreply.enabled" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  await setWhatsAppAiConfig({
    ...previousConfig,
    defaultMode: "COPILOT",
    schedule: { ...previousConfig.schedule, mode: "always" },
    context: { ...previousConfig.context, v2: true },
    dossier: { enabled: true },
  });
  // Con el flujo de venta (como producción) «ya estoy lista para agendar» pide
  // horas: un calendario de mentira, nunca el de Dayana.
  const slot = (hours: number) => {
    const start = new Date(Date.now() + hours * 3600_000);
    return { startIso: start.toISOString(), endIso: new Date(start.getTime() + 15 * 60_000).toISOString(), dateKey: start.toISOString().slice(0, 10), time: "" };
  };
  setFreeCallCalendarForTests({ available: async () => [slot(26), slot(30), slot(50)] });
  await cleanup();
  try {
    console.log("\n1. Chat de hace tres meses, importado");
    const imported = await importExportChat({ text: EXPORT, fileName: "Chat de WhatsApp con Carla.txt", phoneE164: PHONE, dayanaAuthor: "Dayana Beltrán" });
    check("se importaron los 6 mensajes", imported.stored === 6, imported);
    // Lo que hace «Construir fichas» (o el reloj) después de importar.
    const built = await updateDossier(imported.conversationId!);
    check("se armó la ficha", built.built && built.done, built);

    console.log("\n2. Hoy vuelve a escribir");
    const live: NormalizedMessage = {
      kind: "message",
      channel: "WHATSAPP",
      metaAccountId: "test-phone-id",
      threadId: THREAD,
      externalMessageId: `wamid.e2e.context.${Date.now()}`,
      isEcho: false,
      body: "Hola, ya estoy lista para agendar",
      attachments: [],
      replyToExternalId: null,
      sentAt: new Date(),
      participantName: "Carla",
    };
    await processNormalizedEvent("whatsapp_business_account", live);

    const conv = await prisma.conversation.findFirstOrThrow({ where: { channel: "WHATSAPP", externalThreadId: THREAD } });
    const run = await prisma.whatsAppAiRun.findFirst({ where: { conversationId: conv.id }, orderBy: { queuedAt: "desc" } });
    const context = (run?.context ?? {}) as { situation?: string; imported?: number; dossier?: unknown; transcript?: number };
    check("la IA corrió y dejó propuesta (copiloto)", run?.status === "AWAITING_APPROVAL", { status: run?.status, reason: run?.reason });
    check("la trató como persona con conversación previa", context.situation === "returning", context);
    check("leyó lo importado", (context.imported ?? 0) >= 6, context);
    check("leyó la ficha", Boolean(context.dossier), context);

    const dossier = await prisma.whatsAppDossier.findUnique({ where: { conversationId: conv.id } });
    const facts = (dossier?.facts ?? {}) as { country?: string; city?: string; buyButtons?: { key: string }[]; invitedToCall?: boolean };
    console.log("     ficha:", JSON.stringify({ summary: dossier?.summary, facts }).slice(0, 600));
    check("la ficha cubre el chat", (dossier?.coveredCount ?? 0) >= 6, dossier?.coveredCount);
    check(
      "la ficha sabe de dónde escribe",
      /monterrey|m[eé]xico/i.test(`${facts.city ?? ""} ${facts.country ?? ""} ${dossier?.summary ?? ""}`),
      facts
    );
    check("la ficha sabe qué la trae (ansiedad)", Boolean(facts.buyButtons?.some((b) => b.key === "ansiedad")), facts.buyButtons);

    const proposal = (run?.proposal ?? {}) as { message?: string; kind?: string };
    console.log("     propuesta:", proposal.message ?? JSON.stringify(proposal));
    check(
      "no vuelve a preguntar de dónde escribe",
      Boolean(proposal.message) && !/desde qu[eé] pa[ií]s|de d[oó]nde (me )?escribes/i.test(proposal.message ?? ""),
      proposal
    );
  } finally {
    setFreeCallCalendarForTests({});
    await cleanup();
    await setWhatsAppAiConfig(previousConfig);
    if (previousProvider) await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: previousProvider.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    if (previousEnabled) await prisma.siteSetting.update({ where: { key: "whatsapp.autoreply.enabled" }, data: { value: previousEnabled.value } });
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.log(`\n❌ ${failures.length} fallos`);
    process.exit(1);
  }
  console.log("\n✅ Contexto: todo bien");
};

main();
