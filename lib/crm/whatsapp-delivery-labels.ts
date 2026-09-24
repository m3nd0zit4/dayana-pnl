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
