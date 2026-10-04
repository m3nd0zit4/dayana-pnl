/**
 * Una sola forma de decir qué pasó con un mensaje de WhatsApp, en todo el
 * CRM (chat, línea de estado de la IA, ficha, listas, Envíos, diagnósticos).
 * Sale siempre del estado que devuelve WhatsApp para ESE mensaje: si en un
 * lado dice «le llegó», en todos dice «le llegó».
 *
 * - SENT: WhatsApp lo aceptó, pero todavía no confirma que le llegó.
 * - DELIVERED: le llegó a su teléfono.
 * - READ: lo abrió.
 * - FAILED: WhatsApp no pudo entregarlo (se muestra el motivo).
 */

export type DeliveryTone = "wait" | "ok" | "read" | "fail";

export const failedLabel = (reason: string): string =>
  /undeliverable/i.test(reason)
    ? "WhatsApp no pudo entregarlo a esa persona"
    : /24|re-engagement|window|ventana/i.test(reason)
      ? "pasaron más de 24 h desde su último mensaje"
      : /template|plantilla/i.test(reason)
        ? "problema con la plantilla"
        : /not.*whatsapp|incapable|invalid.*(phone|recipient)/i.test(reason)
          ? "ese número no tiene WhatsApp"
          : reason;

export const deliveryLabel = (
  status: string | null | undefined,
  failedReason?: string | null
): { label: string; tone: DeliveryTone } => {
  switch ((status ?? "").toUpperCase()) {
    case "READ":
      return { label: "Lo leyó", tone: "read" };
    case "DELIVERED":
      return { label: "Le llegó", tone: "ok" };
    case "FAILED":
      return { label: `No le llegó${failedReason ? `: ${failedLabel(failedReason)}` : ""}`, tone: "fail" };
    case "PENDING":
      return { label: "Enviando…", tone: "wait" };
    default:
      return { label: "Enviado, aún no le llega", tone: "wait" };
  }
};

/** Lo que se sabe del último WhatsApp a una persona (ver `whatsAppStatusFor`). */
export type PersonWhatsAppFacts = {
  lastSentAt: string | null;
  lastStatus: string | null;
  answeredAt: string | null;
};

export type PersonStatusTone = DeliveryTone | "answered";

/**
 * La línea de estado de una persona en las listas (inscritas, alumnas,
 * comunidades): «Respondió» si contestó después del último envío; si no, lo
 * que WhatsApp dice de ese envío. `at` es la hora que va al lado: la de su
 * respuesta o la del envío. `null` = nunca se le escribió por WhatsApp.
 */
export const personStatusLine = (
  facts: PersonWhatsAppFacts | null | undefined
): { label: string; tone: PersonStatusTone; at: string } | null => {
  if (!facts?.lastSentAt) return null;
  if (facts.answeredAt) return { label: "Respondió", tone: "answered", at: facts.answeredAt };
  const status = (facts.lastStatus ?? "").toUpperCase();
  // En una fila no cabe el motivo: va en la ficha y en el chat.
  if (status === "FAILED") return { label: "No le llegó", tone: "fail", at: facts.lastSentAt };
  const { label, tone } = deliveryLabel(status);
  return { label, tone, at: facts.lastSentAt };
};

/** «4 oct, 4:16 a. m.»: corto, para una sola línea (sin el «de» de es-CO). */
export const shortWhen = (iso: string, timeZone?: string): string => {
  const d = new Date(iso);
  const day = d
    .toLocaleDateString("es-CO", { timeZone, day: "numeric", month: "short" })
    .replace(/\s+de\s+/, " ");
  const time = d.toLocaleTimeString("es-CO", { timeZone, hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
};
