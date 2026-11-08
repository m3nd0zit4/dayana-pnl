/**
 * Ajustes de la voz del asistente (`site_settings` «agent.voice», un JSON).
 * Puro: el parseo y las reglas de horario se prueban sin base de datos.
 *
 * Nada de esto es una clave: las credenciales (Gemini, Twilio, 360dialog)
 * siguen en variables de entorno que pega la dueña.
 */

export const AGENT_VOICE_SETTING = "agent.voice";

export type CallProviderId = "off" | "fake" | "twilio" | "whatsapp";
export const CALL_PROVIDERS: readonly CallProviderId[] = ["off", "fake", "twilio", "whatsapp"];

export type AgentVoiceSettings = {
  /** Número personal de Dayana en E.164 (no el de la empresa: desde ese sale todo). */
  ownerPhone: string | null;
  /** El agente puede mandarle notas de voz por WhatsApp. */
  voiceNotes: boolean;
  /** Además del aviso en la campana, sus mensajes por iniciativa propia le llegan como nota de voz. */
  voiceNotesProactive: boolean;
  /** Llamadas: apagado por defecto. `fake` = no llama a nadie, solo registra (pruebas). */
  calls: CallProviderId;
  /** Horario (hora de Bogotá) en el que se le puede llamar o mandar notas por iniciativa propia. */
  quietStartHour: number;
  quietEndHour: number;
};

export const DEFAULT_AGENT_VOICE: AgentVoiceSettings = {
  ownerPhone: null,
  voiceNotes: false,
  voiceNotesProactive: false,
  calls: "off",
  quietStartHour: 8,
  quietEndHour: 21,
};

const hour = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 24 ? v : fallback;

export const normalizePhone = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d+]/g, "");
  const e164 = digits.startsWith("+") ? `+${digits.slice(1).replace(/\D/g, "")}` : `+${digits.replace(/\D/g, "")}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
};

/** Cada campo por su cuenta: uno malo vuelve a su valor por defecto, no todo. */
export const parseAgentVoiceSettings = (raw: string | null | undefined): AgentVoiceSettings => {
  let data: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    /* fila rota → valores por defecto */
  }
  const calls = CALL_PROVIDERS.includes(data.calls as CallProviderId) ? (data.calls as CallProviderId) : "off";
  const quietStartHour = hour(data.quietStartHour, DEFAULT_AGENT_VOICE.quietStartHour);
  const quietEndHour = hour(data.quietEndHour, DEFAULT_AGENT_VOICE.quietEndHour);
  const validWindow = quietStartHour < quietEndHour;
  return {
    ownerPhone: normalizePhone(data.ownerPhone),
    voiceNotes: data.voiceNotes === true,
    voiceNotesProactive: data.voiceNotesProactive === true,
    calls,
    quietStartHour: validWindow ? quietStartHour : DEFAULT_AGENT_VOICE.quietStartHour,
    quietEndHour: validWindow ? quietEndHour : DEFAULT_AGENT_VOICE.quietEndHour,
  };
};

/** Hora y minuto en Bogotá (UTC−5, sin horario de verano). */
const bogotaHour = (now: Date): number => {
  const ms = now.getTime() - 5 * 3600_000;
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
};

/** ¿Se le puede llamar / mandar algo por iniciativa propia ahora? Lo que ella pide, siempre. */
export const withinOwnerHours = (settings: Pick<AgentVoiceSettings, "quietStartHour" | "quietEndHour">, now: Date): boolean => {
  const h = bogotaHour(now);
  return h >= settings.quietStartHour && h < settings.quietEndHour;
};

/** Tope por hora y por día de lo que el agente le manda o la llama (un token MCP no puede saturarle el teléfono). */
export const OWNER_VOICE_LIMITS = {
  voiceNote: { perHour: 6, perDay: 20 },
  call: { perHour: 2, perDay: 6 },
} as const;

export const overLimit = (
  kind: keyof typeof OWNER_VOICE_LIMITS,
  counts: { lastHour: number; lastDay: number }
): "hour" | "day" | null => {
  const limit = OWNER_VOICE_LIMITS[kind];
  if (counts.lastDay >= limit.perDay) return "day";
  if (counts.lastHour >= limit.perHour) return "hour";
  return null;
};
