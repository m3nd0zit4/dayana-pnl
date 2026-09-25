/**
 * En qué punto está una persona con Dayana, en una línea. Se deriva de lo que
 * ya hay en el CRM (matrículas, pagos, citas, diagnóstico, chat): no hay un
 * campo que alguien tenga que mantener a mano.
 */

export type StageInput = {
  enrollments: { status: string; sessionsUsed: number; sessionsTotal: number | null; product?: string | null }[];
  nextAppointment?: { startsAt: Date; sessionsLabel: string | null } | null;
  lastAppointment?: { startsAt: Date } | null;
  hasDiagnostic?: boolean;
  /** Mensajes en su chat de WhatsApp. */
  messages?: number;
};

export type Stage = { key: "nuevo" | "conversando" | "llamada_gratis" | "clienta_activa" | "termino"; label: string };

export const contactStage = (input: StageInput): Stage => {
  const active = input.enrollments.find((e) => e.status === "ACTIVE");
  if (active) {
    const sessions = active.sessionsTotal ? ` (sesiones ${active.sessionsUsed} de ${active.sessionsTotal})` : "";
    return { key: "clienta_activa", label: `Clienta activa${active.product ? ` · ${active.product}` : ""}${sessions}` };
  }
  if (input.enrollments.some((e) => e.status === "COMPLETED")) {
    return { key: "termino", label: "Ya terminó un proceso con Dayana" };
  }
  const next = input.nextAppointment;
  if (next && (!next.sessionsLabel || next.sessionsLabel === "0/0")) {
    return { key: "llamada_gratis", label: "Tiene agendada la llamada gratis" };
  }
  if ((input.messages ?? 0) > 2 || input.hasDiagnostic || input.enrollments.some((e) => e.status === "PENDING_PAYMENT" || e.status === "LEAD")) {
    return { key: "conversando", label: "Conversando (aún no es clienta)" };
  }
  return { key: "nuevo", label: "Nueva: primera vez que escribe" };
};
