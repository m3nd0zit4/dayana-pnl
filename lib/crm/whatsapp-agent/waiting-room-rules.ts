import { isFreeCallAppointment } from "./event-title";

/**
 * La sala de espera de la llamada gratis (pedido de la dueña), en reglas
 * puras. Dayana hace la llamada gratis por WhatsApp, así que no hay forma de
 * ver si está en una llamada: se deduce del calendario.
 *
 * Cuando una persona con la llamada gratis agendada escribe cerca de su hora y
 * Dayana todavía no ha empezado con ella:
 * - si Dayana está en otra cita o reunión (algo en el calendario cruza este
 *   momento, o acaba de terminar): «Dayana está terminando una reunión, por
 *   favor espérala unos 5 minutos»;
 * - si no está ocupada pero ya es la hora: «ya le aviso a Dayana».
 *
 * Solo para la llamada GRATIS (una sesión pagada no recibe estos mensajes), a
 * lo sumo dos avisos por cita, con al menos 5 minutos entre uno y otro.
 */

export type WaitingConfig = {
  /** Minutos antes de la hora en que ya cuenta. */
  beforeMin: number;
  /** Minutos después de la hora en que todavía cuenta. */
  afterMin: number;
  /** Una reunión que terminó hace estos minutos o menos todavía «está terminando». */
  justEndedMin: number;
  maxNotices: number;
  /** Minutos mínimos entre dos avisos de la misma cita. */
  minGapMin: number;
};

export const DEFAULT_WAITING: WaitingConfig = { beforeMin: 10, afterMin: 30, justEndedMin: 5, maxNotices: 2, minGapMin: 5 };

export type WaitingAppointment = {
  startsAt: Date;
  endsAt: Date;
  sessionsLabel: string | null;
  bookingService?: string | null;
};

export type WaitingDecision =
  | { kind: "busy"; reason: string }
  | { kind: "not_started"; reason: string }
  | { kind: "none"; reason: string };

export const decideWaiting = (input: {
  now: Date;
  appointment: WaitingAppointment | null;
  /** Lo ocupado del calendario cerca de ahora (sin esta misma cita). */
  busy: { start: Date; end: Date }[];
  /** Lo último que Dayana le escribió a esta persona (no la IA, no masivos). */
  lastDayanaAt: Date | null;
  notices: { count: number; lastAt: Date | null };
  config?: WaitingConfig;
}): WaitingDecision => {
  const cfg = input.config ?? DEFAULT_WAITING;
  const a = input.appointment;
  if (!a) return { kind: "none", reason: "sin cita cerca" };
  if (!isFreeCallAppointment(a)) return { kind: "none", reason: "no es la llamada gratis" };

  const now = input.now.getTime();
  const start = a.startsAt.getTime();
  if (now < start - cfg.beforeMin * 60_000 || now > start + cfg.afterMin * 60_000) {
    return { kind: "none", reason: "fuera de la hora de la cita" };
  }
  // Dayana ya le escribió cerca de la hora: está con ella.
  if (input.lastDayanaAt && input.lastDayanaAt.getTime() >= start - cfg.beforeMin * 60_000) {
    return { kind: "none", reason: "Dayana ya empezó con ella" };
  }
  if (input.notices.count >= cfg.maxNotices) return { kind: "none", reason: "ya se le avisó" };
  if (input.notices.lastAt && now - input.notices.lastAt.getTime() < cfg.minGapMin * 60_000) {
    return { kind: "none", reason: "se le avisó hace muy poco" };
  }

  const busyNow = input.busy.some((b) => {
    const s = b.start.getTime();
    const e = b.end.getTime();
    if (s === start) return false; // la misma cita
    return (s <= now && now < e) || (e <= now && now - e <= cfg.justEndedMin * 60_000);
  });
  if (busyNow) return { kind: "busy", reason: "Dayana está en otra cita o reunión" };
  if (now >= start - 2 * 60_000) return { kind: "not_started", reason: "ya es la hora y Dayana no ha empezado" };
  return { kind: "none", reason: "todavía no es la hora" };
};

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? "";

/** Lo que se le dice a la persona, con la voz de la asistente. */
export const waitingMessage = (kind: "busy" | "not_started", name: string | null | undefined): string => {
  const hi = firstName(name) ? `Hola ${firstName(name)}` : "Hola";
  return kind === "busy"
    ? `${hi} 🙏 Dayana está terminando una reunión. Por favor espérala unos 5 minutos y te llama por aquí.`
    : `${hi}, ya le aviso a Dayana. En un momento te llama por aquí 🙏`;
};
