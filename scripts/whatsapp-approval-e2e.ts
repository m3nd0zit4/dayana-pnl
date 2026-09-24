/**
 * Prueba de punta a punta de las autorizaciones, contra la base de DESARROLLO:
 * alguien pide el enlace de pago → la IA deja la propuesta esperando a Dayana
 * (no manda nada) → se aprueba → se crea el enlace real y se envía (modo prueba).
 * Después, un mensaje de Dayana desde el celular retira una propuesta pendiente.
 *
 *   WHATSAPP_AI_DEBOUNCE_MS=2000 GEMINI_MODEL=gemini-3.5-flash NOTIFICATIONS_DRY_RUN=true bun scripts/whatsapp-approval-e2e.ts
 */
import { prisma } from "@/lib/db";
import { approveProposal } from "@/lib/crm/whatsapp-agent/approvals";
import { processNormalizedEvent } from "@/lib/meta/ingest";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";

const PHONE = "570000008888";

const msg = (id: string, body: string, isEcho = false): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId: PHONE,
  externalMessageId: `wamid.appr.${id}.${Date.now()}`,
  isEcho,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: isEcho ? null : "Andrés Prueba",
});

const show = async (label: string) => {
  const c = await prisma.conversation.findFirst({
    where: { channel: "WHATSAPP", externalThreadId: PHONE },
    include: { messages: { orderBy: { sentAt: "asc" } }, aiRuns: { orderBy: { queuedAt: "asc" } } },
  });
  console.log(`\n--- ${label}`);
  for (const m of c?.messages ?? []) console.log(`  ${m.direction}${m.isAutoReply ? " (IA)" : ""}: ${m.body}`);
  for (const r of c?.aiRuns ?? [])
    console.log(`  RUN ${r.status} ${r.reason ?? ""} ${r.proposal ? JSON.stringify(r.proposal).slice(0, 260) : ""}`);
  return c;
};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo dev.");
  if (process.env.NOTIFICATIONS_DRY_RUN !== "true") throw new Error("NOTIFICATIONS_DRY_RUN=true");
  const prev = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: PHONE } });
  try {
    await processNormalizedEvent(
      "whatsapp_business_account",
      msg("a", "Hola, soy Andrés. Ya lo pensé y quiero pagar el paquete de 3 sesiones, ¿me pasas el link de pago?")
    );
    const c1 = await show("después del mensaje (debe haber propuesta, sin envío)");
    const pending = c1?.aiRuns.find((r) => r.status === "AWAITING_APPROVAL");
    if (!pending) throw new Error("No quedó propuesta pendiente.");
    const staff = await prisma.staffUser.findFirst({ where: { role: "OWNER" }, select: { id: true } });
    const result = await approveProposal({ runId: pending.id, conversationId: c1!.id, staffId: staff!.id });
    console.log("\nENVIADO:", result.sent);
    await show("después de aprobar");

    // Una propuesta pendiente se retira cuando Dayana escribe desde el celular.
    await processNormalizedEvent("whatsapp_business_account", msg("b", "¿Y aceptan tarjeta?"));
    await show("nueva pregunta (en modo IA responde sola si no es cita ni pago)");
  } finally {
    if (prev) await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: prev.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: PHONE } });
  }
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
