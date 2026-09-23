/**
 * Prueba de punta a punta del ejecutor de la IA de WhatsApp, contra la base de
 * DESARROLLO: dos mensajes seguidos de una persona inventada entran como si
 * llegaran por el webhook, la IA espera a que termine de escribir, contesta
 * una vez (envío en modo prueba) y deja su rastro en `whatsapp_ai_runs`.
 *
 *   WHATSAPP_AI_DEBOUNCE_MS=3000 GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-runner-e2e.ts
 */
import { prisma } from "@/lib/db";
import { processNormalizedEvent } from "@/lib/meta/ingest";
import type { NormalizedMessage } from "@/lib/meta/inbound";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";

const PHONE = "570000009999";

const message = (id: string, body: string | null, attachments: NormalizedMessage["attachments"] = []): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId: PHONE,
  externalMessageId: `wamid.e2e.${id}.${Date.now()}`,
  isEcho: false,
  body,
  attachments,
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: "Prueba E2E",
});

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) {
    throw new Error("Solo contra la base de desarrollo (neondb_dev).");
  }
  if (process.env.NOTIFICATIONS_DRY_RUN !== "true") {
    throw new Error("NOTIFICATIONS_DRY_RUN=true para no enviar nada de verdad.");
  }
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  // Sin WhatsApp configurado en desarrollo no hay con qué «enviar» ni en modo
  // prueba: se pone una clave de mentira y al final se deja todo como estaba.
  const previousProvider = await prisma.siteSetting.findUnique({ where: { key: "whatsapp.provider" } });
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });

  // Empezar limpio: el hilo de prueba se borra entero.
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: PHONE } });

  try {
    await runScenario(process.argv[2] ?? "precio");
  } finally {
    if (previousProvider) {
      await prisma.siteSetting.update({ where: { key: "whatsapp.provider" }, data: { value: previousProvider.value } });
    } else {
      await prisma.siteSetting.deleteMany({ where: { key: "whatsapp.provider" } });
    }
  }
};

const runScenario = async (scenario: string) => {
  const burst: NormalizedMessage[] =
    scenario === "pago"
      ? [
          message("a", "hola, ya pagué la sesión"),
          message("b", null, [{ kind: "image", mediaId: "x", mimeType: "image/jpeg" } as never]),
        ]
      : [message("a", "Hola!"), message("b", "¿cuánto cuesta una sesión?")];

  const started = Date.now();
  // Dos avisos casi a la vez, como llegan de verdad.
  const first = processNormalizedEvent("whatsapp_business_account", burst[0]);
  await new Promise((r) => setTimeout(r, 800));
  const second = processNormalizedEvent("whatsapp_business_account", burst[1]);
  await Promise.all([first, second]);

  const conversation = await prisma.conversation.findFirst({
    where: { channel: "WHATSAPP", externalThreadId: PHONE },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      aiRuns: { orderBy: { queuedAt: "asc" } },
    },
  });
  console.log(`\nTardó ${Date.now() - started} ms`);
  console.log("Modo:", conversation?.aiMode, "· pausa:", conversation?.aiPausedReason, conversation?.escalationCategory ?? "");
  console.log("Mensajes:");
  for (const m of conversation?.messages ?? []) {
    console.log(`  ${m.direction}${m.isAutoReply ? " (IA)" : ""} [${m.status}] ${m.body ?? "(adjunto)"}`);
  }
  console.log("Ejecuciones de la IA:");
  for (const r of conversation?.aiRuns ?? []) {
    console.log(`  ${r.status} ${r.reason ?? ""} ${r.category ?? ""} latencia=${r.latencyMs}ms`);
  }
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
