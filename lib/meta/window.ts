import type { ConversationChannel } from "@prisma/client";

/**
 * La ventana de servicio al cliente de Meta.
 *
 * Los tres canales prohíben el texto libre pasadas 24 h desde el último mensaje
 * del cliente. Es, con diferencia, la causa más común de "escribí y no le
 * llegó", así que la interfaz consulta esto **antes** de dejar redactar, en vez
 * de dejar que Meta rechace el envío después.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** El tag HUMAN_AGENT amplía Messenger/Instagram a 7 días. */
const HUMAN_AGENT_MS = 7 * DAY_MS;

export type WindowState = {
  /** Se puede enviar texto libre sin más. */
  isOpen: boolean;
  /** Cuándo se cierra la ventana estándar de 24 h, si está abierta. */
  expiresAt: Date | null;
  /**
   * Qué hace falta para poder escribir ahora mismo.
   * - `free`: nada, la ventana está abierta.
   * - `template`: WhatsApp fuera de ventana — solo plantilla aprobada.
   * - `human_agent`: Messenger/Instagram fuera de 24 h pero dentro de 7 días.
   * - `closed`: ni con plantilla ni con tag; hay que esperar al cliente.
   */
  requirement: "free" | "template" | "human_agent" | "closed";
};

export const resolveWindow = (
  channel: ConversationChannel,
  lastInboundAt: Date | null,
  now: Date = new Date()
): WindowState => {
  // Sin mensaje entrante nunca hubo ventana: en WhatsApp solo cabe plantilla, y
  // en Meta no se puede iniciar conversación en frío en absoluto.
  if (!lastInboundAt) {
    return {
      isOpen: false,
      expiresAt: null,
      requirement: channel === "WHATSAPP" ? "template" : "closed",
    };
  }

  const elapsed = now.getTime() - lastInboundAt.getTime();

  if (elapsed < DAY_MS) {
    return {
      isOpen: true,
      expiresAt: new Date(lastInboundAt.getTime() + DAY_MS),
      requirement: "free",
    };
  }

  if (channel === "WHATSAPP") {
    return { isOpen: false, expiresAt: null, requirement: "template" };
  }

  return {
    isOpen: false,
    expiresAt: null,
    requirement: elapsed < HUMAN_AGENT_MS ? "human_agent" : "closed",
  };
};

/** Texto para la interfaz, para que el operador sepa por qué no puede escribir. */
export const explainWindow = (state: WindowState): string | null => {
  switch (state.requirement) {
    case "free":
      return null;
    case "template":
      return "Pasaron más de 24 h desde el último mensaje del cliente. WhatsApp solo permite enviar una plantilla aprobada.";
    case "human_agent":
      return "Pasaron más de 24 h. Se enviará con la etiqueta de agente humano, válida hasta 7 días desde el último mensaje.";
    case "closed":
      return "Pasaron más de 7 días desde el último mensaje del cliente. Meta no permite escribir hasta que vuelva a contactar.";
  }
};
