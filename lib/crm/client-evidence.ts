import { isAutoSend } from "./whatsapp-attention-rules";
import { foldForSearch } from "./search-normalize";

/**
 * ¿Ya le pagó a Dayana por fuera del CRM? Muchas clientas pagan por
 * transferencia directo a su cuenta, y eso no queda en el CRM: solo en el
 * chat («ya te transferí», «aquí el comprobante», «recibí tu pago», «tu
 * sesión 3»). Esto busca esas frases en TODO el chat, con la cita y la fecha
 * para que Dayana pueda revisarlo.
 *
 * Puro: lo usan `segment-store.ts` y las pruebas.
 *
 * - `strong`: dice que pagó o que tiene sesiones de un proceso.
 * - `weak`: menciona cómo pagar (Nequi, PayPal…): puede ser alguien que
 *   pregunta. No decide sola.
 * Los envíos masivos y las respuestas de la IA no cuentan.
 */

export type EvidenceMessage = {
  direction: string;
  body: string | null;
  sentAt: Date;
  isAutoReply?: boolean;
  source?: string | null;
  clientKey?: string | null;
};

export type ClientEvidence = {
  who: "persona" | "dayana";
  strength: "strong" | "weak";
  quote: string;
  at: string;
};

const PERSON_STRONG = [
  /\bya te (transferi|consigne|pague|envie el (pago|comprobante|dinero))\b/,
  /\b(te )?(hice|realice|mande|envie) (el|la) (pago|transferencia|consignacion|deposito)\b/,
  /\b(aqui|ahi) (esta|va|te (mando|envio)) (el )?comprobante\b/,
  /\bcomprobante de(l)? (pago|transferencia|consignacion)\b/,
  /\bpago (realizado|hecho|enviado|listo)\b/,
  /\bsesion \d+ de \d+\b/,
  /\b(mi|la) (siguiente|proxima) sesion\b/,
];

const DAYANA_STRONG = [
  /\brecibi (tu|el) (pago|comprobante|transferencia|deposito)\b/,
  /\b(confirmo|confirmado|recibido) (tu |el )?pago\b/,
  /\bbienvenid[ao] (a|al) (tu )?(proceso|paquete|programa)\b/,
  /\btu (proxima |siguiente )?sesion (numero )?\d+\b/,
  /\bsesion \d+ de \d+\b/,
];

const PERSON_WEAK = [/\b(nequi|daviplata|bancolombia|paypal|zelle|western union|mercado pago)\b/];

const MAX_QUOTE = 140;

const quoteOf = (body: string) => {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > MAX_QUOTE ? `${flat.slice(0, MAX_QUOTE - 1)}…` : flat;
};

export const findClientEvidence = (messages: EvidenceMessage[]): ClientEvidence[] => {
  const out: ClientEvidence[] = [];
  for (const m of messages) {
    if (!m.body?.trim()) continue;
    const inbound = m.direction === "INBOUND";
    // Lo que sale solo (masivos, recordatorios) o lo que escribió la IA no prueba nada.
    if (!inbound && (m.isAutoReply || isAutoSend(m))) continue;
    const text = foldForSearch(m.body);
    const strong = (inbound ? PERSON_STRONG : DAYANA_STRONG).some((re) => re.test(text));
    const weak = !strong && inbound && PERSON_WEAK.some((re) => re.test(text));
    if (!strong && !weak) continue;
    out.push({
      who: inbound ? "persona" : "dayana",
      strength: strong ? "strong" : "weak",
      quote: quoteOf(m.body),
      at: m.sentAt.toISOString(),
    });
  }
  return out;
};
