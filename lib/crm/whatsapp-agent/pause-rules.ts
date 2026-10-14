import { isManualPause } from "../whatsapp-attention-rules";

/**
 * ¿Sigue en pie la pausa de la IA en un chat? (puro: lo usan `run.ts` y las pruebas)
 *
 * Pedido de la dueña (2026-10-14): la IA contesta siempre, salvo a clientas.
 * Con los interruptores de `pauses` apagados:
 * - Que Dayana conteste (celular o CRM) ya no aparta a la IA 12 horas: solo
 *   no se repite lo que ella ya contestó.
 * - Que la IA le pase algo a Dayana (un pago, una pregunta que no sabe) ya no
 *   la calla en ese chat: avisa, abre «Te toca» y sigue contestando.
 *
 * Siempre pausan, se apague lo que se apague: lo que pausó Dayana a mano
 * («Pausar», bandeja) y lo delicado (una crisis, algo urgente): un robot
 * charlando con alguien en crisis es peor que el silencio.
 */
export type PauseState = {
  reason: string | null;
  escalationCategory: string | null;
  escalationSeverity: string | null;
  escalationReason: string | null;
};

export type PauseSwitches = { onHumanReply: boolean; onEscalation: boolean };

export const isCrisis = (e: { category: string | null; severity: string | null }): boolean =>
  e.category === "clinical" || e.severity === "urgent";

export const pauseHolds = (p: PauseState, switches: PauseSwitches): boolean => {
  if (p.reason === "escalation") {
    if (isManualPause({ category: p.escalationCategory, reason: p.escalationReason })) return true;
    if (isCrisis({ category: p.escalationCategory, severity: p.escalationSeverity })) return true;
    return switches.onEscalation;
  }
  // `human` (o una pausa vieja sin motivo).
  return switches.onHumanReply;
};

/** ¿Escalar esto calla a la IA en el chat? Lo delicado siempre; lo demás, según el interruptor. */
export const escalationPauses = (e: { category: string; severity: string }, switches: PauseSwitches): boolean =>
  isCrisis(e) || switches.onEscalation;
