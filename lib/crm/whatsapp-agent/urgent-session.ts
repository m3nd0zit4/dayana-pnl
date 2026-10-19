import { foldForSearch } from "../search-normalize";
import type { WhatsAppAiConfig } from "../whatsapp-ai-config";

/**
 * La sesión urgente (pedido de la dueña, 19-oct; chat «CM7 ⚽🥅»): alguien
 * pidió la llamada gratis «hoy mismo», la asistente le dijo que hoy ya no hay
 * espacio y le ofreció el jueves, y la persona insistió («es que es rápido»,
 * «necesitaba hablar con ella»). La asistente le repitió las mismas horas;
 * Dayana tuvo que escribirle ella: «si gustas puedes agendar hoy mismo, ya que
 * es urgente… te envío el link de pago para una sesión personalizada… tan
 * pronto haces el pago agendamos».
 *
 * Desde ahora, cuando de verdad insiste, la asistente le ofrece la sesión
 * privada de 1 hora con el enlace de pago, y Dayana la agenda para hoy o
 * mañana en cuanto pague (ella agenda las sesiones pagadas, como siempre).
 * No es para todos: la regla de abajo pide que lo haya pedido y vuelto a
 * pedir después de que le dijeron que no o le ofrecieron otros días.
 *
 * Puro: la regla, los textos y el prompt.
 */

export const DEFAULT_URGENT_SESSION_URL = "/pagar/p/therapy-1";

export const DEFAULT_URGENT_SESSION_AFTER =
  "Tan pronto hagas el pago, Dayana te agenda la sesión para hoy o mañana por Google Meet.";

/** Lo que recibe la persona si el modelo no lo escribió bien (el enlace va debajo). */
export const URGENT_SESSION_REPLY =
  "Entiendo que es urgente. Si necesitas hablar con Dayana hoy, puedes tomar una sesión privada de 1 hora con ella por Google Meet. Aquí puedes hacer el pago";

type Line = { direction: "INBOUND" | "OUTBOUND"; body: string | null; sentAt?: Date };

/** Urgencia que se entiende sola. */
const STRONG =
  /\b(hoy mismo|ahora mismo|ya mismo|urgente|urge|urgencia|emergencia|es rapido|es algo rapido|rapidito|cuanto antes|lo antes posible|lo mas pronto posible|de inmediato|inmediatamente|no puedo esperar|(necesito|necesitaba|tengo que) hablar con (ella|dayana|usted|la doctora))\b/;
/** «Hoy», «ahora»: solo cuentan en un mensaje corto o junto a llamar o hablar. */
const TODAY = /\b(hoy|ahora|ahorita)\b/;
const TALK = /\b(llam\w*|habl\w*|cita|agend\w*|atend\w*|atiend\w*|sesion|consulta)\b/;
/**
 * Lo que la asistente (o Dayana) le contestó en el medio: que hoy no hay
 * espacio, otras horas u otros días.
 */
const SCHEDULING =
  /(no (hay|tenemos|tiene|queda[n]?)|ya no|sin espacio|agend|disponib|te sirve|horario|cita previa|\b\d{1,2}:\d{2}\b|\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|manana)\b)/;

/** Solo lo reciente: lo que pidió hace días no es la urgencia de ahora. */
const WINDOW_MS = 6 * 3600_000;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** ¿Este turno de la persona pide hablar ya? */
export const asksForNow = (text: string): boolean => {
  const t = foldForSearch(text).replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (STRONG.test(t)) return true;
  // «Hoy no puedo», «ahora no»: es lo contrario.
  return TODAY.test(t) && !/\bno\b/.test(t) && (words(t) <= 3 || TALK.test(t));
};

export type UrgencyCheck = {
  insisted: boolean;
  /** Lo que escribió en cada turno urgente (para el aviso a Dayana). */
  asks: string[];
};

/**
 * ¿Insiste en hablar con Dayana hoy? El último turno de la persona pide
 * hablar ya, y antes hubo otro igual con una respuesta en el medio que le
 * dijo que hoy no hay espacio o le ofreció otros días u horas.
 */
export const urgencyInsisted = (lines: Line[]): UrgencyCheck => {
  const lastIn = [...lines].reverse().find((l) => l.direction === "INBOUND");
  const since = lastIn?.sentAt ? lastIn.sentAt.getTime() - WINDOW_MS : null;
  const recent = since == null ? lines.slice(-40) : lines.filter((l) => !l.sentAt || l.sentAt.getTime() >= since);

  // Turnos: los mensajes seguidos de la persona van juntos («Hoy» + «Mismo»).
  const turns: { inbound: boolean; text: string }[] = [];
  for (const l of recent) {
    const text = l.body?.trim();
    if (!text) continue;
    const inbound = l.direction === "INBOUND";
    const last = turns[turns.length - 1];
    if (last && last.inbound === inbound) last.text += `\n${text}`;
    else turns.push({ inbound, text });
  }
  const none = { insisted: false, asks: [] };
  const latest = turns[turns.length - 1];
  if (!latest?.inbound || !asksForNow(latest.text)) return none;

  let answered = false;
  for (let i = turns.length - 2; i >= 0; i--) {
    const t = turns[i];
    if (!t.inbound) {
      if (SCHEDULING.test(foldForSearch(t.text))) answered = true;
      continue;
    }
    if (answered && asksForNow(t.text)) {
      const asks = turns
        .slice(i)
        .filter((x) => x.inbound && asksForNow(x.text))
        .map((x) => x.text.replace(/\s+/g, " ").slice(0, 80));
      return { insisted: true, asks };
    }
  }
  return none;
};

/** El enlace (ruta del sitio o URL completa) si está encendida; null si no. */
export const urgentSessionPath = (config: WhatsAppAiConfig): string | null =>
  config.urgentSession.enabled && config.urgentSession.url.trim() ? config.urgentSession.url.trim() : null;

/** El texto que va debajo del enlace. */
export const urgentSessionAfter = (config: WhatsAppAiConfig): string =>
  config.urgentSession.afterPayment.trim() || DEFAULT_URGENT_SESSION_AFTER;

/** ¿Ya se le mandó ese enlace en este chat? */
export const urgentLinkSent = (lines: Line[], url: string): boolean =>
  lines.some((l) => l.direction === "OUTBOUND" && Boolean(l.body?.includes(url)));

/** La regla del prompt (nada si está apagada). */
export const urgentSessionRules = (config: WhatsAppAiConfig): string => {
  if (!urgentSessionPath(config)) return "";
  return [
    "SESIÓN URGENTE (solo si de verdad insiste):",
    "- Si la persona insiste en hablar con Dayana hoy o ya mismo —lo pidió, le dijiste que hoy no hay espacio o le ofreciste otros días, y vuelve a insistir («hoy mismo», «es que es rápido», «necesito hablar con ella ya»)—, no le repitas las horas de la llamada gratis: usa send_urgent_session_link y contesta corto. Por ejemplo: «Entiendo que es urgente. Si necesitas hablar con Dayana hoy, puedes tomar una sesión privada de 1 hora con ella por Google Meet. Aquí puedes hacer el pago».",
    "- El enlace y el siguiente paso (que Dayana la agenda para hoy o mañana en cuanto pague) los pega el sistema debajo de tu mensaje: no los escribas, no digas el precio, no escribas «hoy mismo» ni que Dayana la llama o la atiende hoy. No escales: Dayana recibe el aviso sola.",
    "- A quien pregunta una sola vez si puede ser hoy, ofrécele las horas de siempre. Si habla de hacerse daño o de una crisis, eso va primero: escala.",
  ].join("\n") + "\n";
};

/** La oferta escrita por el modelo («sesión privada de 1 hora», «Aquí puedes hacer el pago»). */
const OFFERS = /sesion (privada|urgente|personalizada)|aqui puedes hacer el pago/;
export const offersUrgentSession = (text: string): boolean => OFFERS.test(foldForSearch(text));

/**
 * Lo que el modelo inventa en lugar del enlace (18-oct, flash-lite: «***» y
 * «* *Sesión urgente*: [Enlace de pago]», «[Pagar aquí](https://api.whatsapp…)», un
 * título en negrita solo). El enlace de verdad lo pega el código debajo.
 */
export const withoutFakeLinks = (text: string): string =>
  text
    .split("\n")
    .filter(
      (line) =>
        !/\[[^\]\n]{2,80}\](\([^)\n]*\))?/.test(line) &&
        !/^\s*([*_-]\s*){3,}$/.test(line) &&
        // «*Sesión urgente de 1 hora por Google Meet*» solo en su línea: el enlace ya lo dice.
        !/^\s*\*[^*\n]{3,100}\*\s*$/.test(line)
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
