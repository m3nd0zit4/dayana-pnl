/**
 * Voz del asistente contra neondb_dev, sin mandar nada: nota de voz (TTS y
 * envío falsos) y llamada (proveedor `fake`), su respuesta y la limpieza.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent-voice-e2e.ts
 */
import { prisma } from "@/lib/db";
import { getSiteSetting, setSiteSetting, deleteSiteSetting } from "@/lib/crm/site-settings";
import { whatsAppDigits } from "@/lib/whatsapp-contact";
import { CALL_ANSWER_AUDIT, CALL_AUDIT, placeOwnerCall, recordOwnerCallAnswer } from "@/lib/voice/calls/owner-call";
import { fakeProvider } from "@/lib/voice/calls/providers";
import { sendOwnerVoiceNote, VOICE_NOTE_AUDIT } from "@/lib/voice/owner-voice-note";
import { AGENT_VOICE_SETTING } from "@/lib/voice/settings-rules";

const db = new URL(process.env.DATABASE_URL ?? "").pathname;
if (db !== "/neondb_dev") throw new Error(`Solo contra neondb_dev (es ${db}).`);

const PHONE = "+15550100987"; // número de prueba: nunca sale nada (envío falso)
const started = new Date();
const ok = (cond: unknown, label: string) => {
  if (!cond) throw new Error(`FALLÓ: ${label}`);
  console.log(`✓ ${label}`);
};

const original = await getSiteSetting(AGENT_VOICE_SETTING);
const conversationId: string[] = [];
const callKeys: string[] = [];
try {
  // 1. Apagado por defecto: ni nota ni llamada.
  await deleteSiteSetting(AGENT_VOICE_SETTING);
  const off = await sendOwnerVoiceNote({ text: "hola", reason: "request", source: "e2e" });
  ok(!off.sent && off.reason === "off", "sin ajustes, la nota de voz está apagada");
  const offCall = await placeOwnerCall({ message: "hola", reason: "request", source: "e2e" });
  ok(!offCall.placed && offCall.reason === "off", "sin ajustes, las llamadas están apagadas");

  // 2. Encendido con un número de prueba.
  await setSiteSetting(AGENT_VOICE_SETTING, JSON.stringify({ ownerPhone: PHONE, voiceNotes: true, calls: "fake" }));
  let sentPayload: Parameters<typeof import("@/lib/meta/send").sendMetaMessage>[0] | null = null;
  const note = await sendOwnerVoiceNote(
    { text: "**Hola Dayana**, tienes [3 chats](/admin/whatsapp) pendientes 🙏", reason: "request", source: "e2e" },
    {
      synthesize: async () => ({ pcm: Int16Array.from({ length: 24000 }, (_, i) => Math.round(Math.sin(i / 10) * 5000)), sampleRate: 24000 }),
      send: async (input) => {
        sentPayload = input;
        return { messageId: "e2e-msg", externalMessageId: null, dryRun: true };
      },
    }
  );
  ok(note.sent, "nota de voz enviada (envío falso)");
  if (note.sent) conversationId.push(note.conversationId);
  const att = sentPayload!.attachment!;
  ok(att.voice === true && att.mimeType === "audio/ogg" && att.bytes && att.bytes.length > 1000, "sale como Ogg/Opus con voice: true");
  ok(String.fromCharCode(...att.bytes!.slice(0, 4)) === "OggS", "los bytes son un Ogg");
  ok(att.transcript === "Hola Dayana, tienes 3 chats pendientes.", "el chat guarda lo que dice, sin markdown ni emojis");
  const conv = await prisma.conversation.findUnique({
    where: { channel_externalThreadId: { channel: "WHATSAPP", externalThreadId: whatsAppDigits(PHONE) } },
    select: { category: true, aiModeOverride: true },
  });
  ok(conv?.category === "equipo" && conv.aiModeOverride === "MANUAL", "su chat queda como «equipo» y la IA de WhatsApp no le contesta");

  // 3. Llamada simulada, su respuesta llega una sola vez al panel.
  const call = await placeOwnerCall({ message: "Laura pagó por Nequi. ¿La registro?", reason: "request", source: "e2e" }, { provider: fakeProvider() });
  ok(call.placed && call.simulated, "llamada simulada registrada");
  if (!call.placed) throw new Error("sin llamada");
  callKeys.push(call.callKey);
  ok((await recordOwnerCallAnswer({ callKey: "no-existe-123", heard: "sí" })).reason === "unknown_call", "una clave inventada no abre nada");
  ok((await recordOwnerCallAnswer({ callKey: call.callKey, heard: "sí, regístrala", providerCallId: "otro" })).reason === "unknown_call", "otro CallSid no vale");
  ok((await recordOwnerCallAnswer({ callKey: call.callKey, heard: "sí, regístrala", providerCallId: call.providerCallId })).ok, "su respuesta se guarda");
  ok((await recordOwnerCallAnswer({ callKey: call.callKey, heard: "sí" })).reason === "already_answered", "un reintento no abre otra conversación");
  const n = await prisma.platformNotification.findFirst({
    where: { entityType: "AgentMessage", createdAt: { gte: started }, title: "Lo que me dijiste en la llamada" },
    select: { body: true },
  });
  ok(n?.body?.includes("«sí, regístrala»"), "llega como mensaje del asistente (campana) con lo que dijo");

  // 4. Iniciativa propia fuera de horario: no.
  const late = await placeOwnerCall(
    { message: "x", reason: "proactive", source: "e2e" },
    { provider: fakeProvider(), now: () => new Date("2026-11-09T04:00:00Z") }
  );
  ok(!late.placed && late.reason === "quiet_hours", "de noche no llama por su cuenta");
  console.log("\nTodo bien.");
} finally {
  // Limpieza: nada de esto queda en dev.
  await prisma.platformNotification.deleteMany({ where: { entityType: "AgentMessage", createdAt: { gte: started }, metadata: { path: ["source"], string_starts_with: "call:" } } });
  await prisma.auditLog.deleteMany({ where: { entityType: { in: [VOICE_NOTE_AUDIT, CALL_AUDIT, CALL_ANSWER_AUDIT] }, createdAt: { gte: started } } });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: whatsAppDigits(PHONE) } });
  if (original == null) await deleteSiteSetting(AGENT_VOICE_SETTING);
  else await setSiteSetting(AGENT_VOICE_SETTING, original);
  await prisma.$disconnect();
}
