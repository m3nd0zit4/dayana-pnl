import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";
import { ensureWhatsAppConversation } from "@/lib/crm/whatsapp-outbound";
import { MetaWindowError, sendMetaMessage } from "@/lib/meta/send";
import { pcmToOggOpus } from "./opus-ogg";
import { getAgentVoiceSettings, ownerPhoneProblem } from "./settings";
import { overLimit, withinOwnerHours } from "./settings-rules";
import { toSpeechText } from "./speech-text";
import { synthesizeSpeech } from "./tts";

/**
 * Una nota de voz del asistente al WhatsApp personal de Dayana.
 *
 * Sale desde el número de la empresa (360dialog, coexistencia) al número que
 * ella guardó en Ajustes → Canales del agente; nunca a otro. Como cualquier
 * mensaje libre de WhatsApp, solo entra dentro de las 24 h desde el último
 * mensaje que ella le escribió a ese número: fuera de la ventana no hay
 * plantilla de audio (Meta no admite cabecera de audio), así que se dice y el
 * aviso queda en la campana.
 */

export const VOICE_NOTE_AUDIT = "AGENT_VOICE_NOTE";
export const VOICE_NOTE_MAX_CHARS = 900;

export type VoiceNoteResult =
  | { sent: true; conversationId: string; messageId: string; seconds: number; dryRun: boolean }
  | { sent: false; reason: "off" | "no_phone" | "bad_phone" | "quiet_hours" | "limit" | "window_closed" | "failed"; detail: string };

const countRecent = async (since: Date) =>
  prisma.auditLog.count({ where: { entityType: VOICE_NOTE_AUDIT, createdAt: { gte: since } } });

/** Para pruebas: TTS, codificador y envío falsos. */
export type VoiceNoteDeps = {
  synthesize?: typeof synthesizeSpeech;
  send?: typeof sendMetaMessage;
  now?: () => Date;
};

export const sendOwnerVoiceNote = async (
  input: {
    text: string;
    /** `request` = ella lo pidió (sin horario); `proactive` = por iniciativa del asistente. */
    reason: "request" | "proactive" | "test";
    source: string;
    staffUserId?: string | null;
  },
  deps: VoiceNoteDeps = {}
): Promise<VoiceNoteResult> => {
  const settings = await getAgentVoiceSettings();
  const now = (deps.now ?? (() => new Date()))();
  if (!settings.voiceNotes && input.reason !== "test") {
    return { sent: false, reason: "off", detail: "Las notas de voz están apagadas (Ajustes → Canales del agente)." };
  }
  if (!settings.ownerPhone) {
    return { sent: false, reason: "no_phone", detail: "Falta el número personal de Dayana en Ajustes → Canales del agente." };
  }
  const problem = await ownerPhoneProblem(settings.ownerPhone);
  if (problem) return { sent: false, reason: "bad_phone", detail: problem };
  if (input.reason === "proactive" && !withinOwnerHours(settings, now)) {
    return { sent: false, reason: "quiet_hours", detail: "Fuera del horario en que se le pueden mandar notas de voz." };
  }
  const [lastHour, lastDay] = await Promise.all([
    countRecent(new Date(now.getTime() - 3600_000)),
    countRecent(new Date(now.getTime() - 24 * 3600_000)),
  ]);
  const limit = overLimit("voiceNote", { lastHour, lastDay });
  if (limit) {
    return { sent: false, reason: "limit", detail: limit === "hour" ? "Ya van muchas notas de voz en la última hora." : "Ya se llegó al tope de notas de voz de hoy." };
  }

  const spoken = toSpeechText(input.text, { maxChars: VOICE_NOTE_MAX_CHARS });
  const conv = await ensureWhatsAppConversation({ phoneE164: settings.ownerPhone, name: "Dayana (asistente)" });
  // Su chat no es de trabajo: la IA de WhatsApp no le contesta ni lo clasifica como clienta.
  await prisma.conversation.updateMany({
    where: { id: conv.id, OR: [{ category: null }, { categorySource: { not: "manual" } }] },
    data: { category: "equipo", categorySource: "manual", categoryReason: "Número personal de Dayana (voz del asistente)", aiModeOverride: "MANUAL" },
  });

  try {
    const { pcm, sampleRate } = await (deps.synthesize ?? synthesizeSpeech)(spoken);
    const { ogg, seconds } = pcmToOggOpus(pcm, sampleRate);
    const result = await (deps.send ?? sendMetaMessage)({
      conversationId: conv.id,
      body: "",
      staffUserId: input.staffUserId ?? null,
      source: `asistente:voz:${input.source}`,
      attachment: { url: "", bytes: ogg, mimeType: "audio/ogg", filename: "nota-de-voz.ogg", voice: true, transcript: spoken },
    });
    await writeAuditLog({
      staffUserId: input.staffUserId ?? undefined,
      action: "CREATE",
      entityType: VOICE_NOTE_AUDIT,
      entityId: result.messageId,
      changes: { reason: input.reason, source: input.source, seconds: Math.round(seconds), chars: spoken.length },
    });
    return { sent: true, conversationId: conv.id, messageId: result.messageId, seconds, dryRun: result.dryRun };
  } catch (err) {
    if (err instanceof MetaWindowError) {
      return {
        sent: false,
        reason: "window_closed",
        detail: "Pasaron más de 24 h desde tu último mensaje a ese número: escríbele cualquier cosa (un «hola») y vuelve a intentarlo.",
      };
    }
    return { sent: false, reason: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
};
