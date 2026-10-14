import { foldForSearch } from "../search-normalize";

/**
 * ¿Lo último que escribió una clienta es de pagos? (puro: lo usan `run.ts` y
 * las pruebas)
 *
 * A una clienta la atiende Dayana y la IA calla, salvo en esto (pedido de la
 * dueña, 2026-10-14): si pide los datos de pago, las cuentas o el enlace, o
 * manda un comprobante, la asistente se los manda o lo recibe y le avisa a
 * Dayana. Lo demás sigue siendo de Dayana.
 */

const ASKS = [
  /\b(numero|datos|n°|no\.?) de (la )?cuenta\b/,
  /\b(a|en) (que|cual) cuenta\b/,
  /\bdatos (de|para) (pago|pagar|consignar|transferir|la transferencia)\b/,
  /\b(link|enlace|link de pago|enlace de pago)\b.*\b(pago|pagar)\b|\b(pago|pagar)\b.*\b(link|enlace)\b/,
  /\bcomo (te |le )?(pago|puedo pagar|hago el pago|consigno|transfiero)\b/,
  /\bdonde (te |le )?(pago|consigno|transfiero|deposito)\b/,
  /\b(quiero|voy a|puedo) (pagar|consignar|transferir|abonar)\b/,
  /\bme (pasas|envias|mandas|regalas|compartes) (la cuenta|el numero de cuenta|los datos|el link|el enlace)\b/,
  /\b(nequi|daviplata|bancolombia|western union|global ?66|remitly|paypal|zelle)\b/,
];

const PAID = [
  /\bcomprobante\b/,
  /\bya (te |le )?(pague|transferi|consigne|deposite|envie el pago|hice el pago|realice el pago)\b/,
  /\b(hice|realice|envie|mande) (el|la) (pago|transferencia|consignacion|deposito)\b/,
  /\bpago (realizado|hecho|enviado|listo)\b/,
  /\bno (me )?(paso|salio|pasa|sale) (el pago|la transferencia)\b/,
  /\b(rechazad[ao]|rebotad[ao]|devolvio)\b.*\b(pago|transferencia)\b/,
];

type BurstMessage = { direction: string; body: string | null; attachments?: unknown; kind?: string | null };

/** Los mensajes de la persona después de lo último que se le escribió (la ráfaga que se contesta). */
const lastBurst = (messagesOldestFirst: BurstMessage[]): BurstMessage[] => {
  let i = messagesOldestFirst.length;
  while (i > 0 && messagesOldestFirst[i - 1].direction === "INBOUND") i--;
  return messagesOldestFirst.slice(i).filter((m) => m.kind !== "system");
};

const hasReceiptFile = (m: BurstMessage): boolean =>
  Array.isArray(m.attachments) &&
  (m.attachments as { kind?: string; mimeType?: string | null }[]).some(
    (a) => a.kind === "image" || (a.kind === "document" && (a.mimeType ?? "").includes("pdf"))
  );

/** ¿Pide datos de pago o el enlace, dice que pagó o manda una foto/PDF (posible comprobante)? */
export const wantsPaymentHelp = (messagesOldestFirst: BurstMessage[]): boolean => {
  const burst = lastBurst(messagesOldestFirst);
  if (burst.length === 0) return false;
  if (burst.some(hasReceiptFile)) return true;
  const text = foldForSearch(burst.map((m) => m.body ?? "").join(" \n "));
  return ASKS.some((re) => re.test(text)) || PAID.some((re) => re.test(text));
};
