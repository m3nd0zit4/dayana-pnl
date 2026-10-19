import type { MeetConference } from "@/lib/google/meet";
import { foldForSearch } from "../search-normalize";
import { isDayana, type DayanaIdentity } from "./no-show-rules";

/**
 * Te esperan en la sala (pedido de la dueña, 19-oct): a la hora de una sesión
 * pagada con Meet, Dayana recibe un aviso en el celular cuando la persona ya
 * está esperando, con su nombre. Antes solo existía el aviso de «no entró»
 * (`no-show-rules.ts`), y si Dayana se demoraba nadie le decía que la persona
 * ya estaba ahí.
 *
 * Dos señales:
 * - Meet: la persona ya entró a la reunión y Dayana todavía no.
 * - El chat: escribe que está esperando o que no la dejan entrar. Google no
 *   avisa de quien pide permiso para entrar («Solicitar unirse»): esa persona
 *   no está en la reunión hasta que la aceptan, así que solo se sabe si lo dice.
 *
 * Nunca le escribe nada a la persona. Reglas puras; la consulta y el aviso
 * están en `session-arrival.ts`.
 */

/** Desde cuánto antes de la hora de la sesión cuenta como «llegó». */
export const ARRIVAL_BEFORE_MIN = 15;
/** Hasta cuánto después. */
export const ARRIVAL_AFTER_MIN = 45;
/** Un segundo «sigo esperando» por el chat vuelve a sonar pasado esto. */
export const ARRIVAL_REPEAT_MIN = 5;

export const inArrivalWindow = (startsAt: Date, now: Date): boolean => {
  const diff = now.getTime() - startsAt.getTime();
  return diff >= -ARRIVAL_BEFORE_MIN * 60_000 && diff <= ARRIVAL_AFTER_MIN * 60_000;
};

const WAITING = new RegExp(
  [
    "ya (entre|ingrese|me (conecte|uni|meti))",
    "ya estoy (aqui|lista|listo|conectad[oa]|adentro|en (la )?(sala|reunion|llamada|videollamada|meet))",
    "estoy (en (la )?(sala|reunion|llamada|videollamada|meet)|conectad[oa]|adentro|esperando|en espera)",
    "(te|la) (estoy )?esperando",
    "esperandote|esperandola|sigo esperando",
    "no me (deja[n]?|acepta[n]?|admite[n]?|da[n]? acceso)",
    "no (puedo|logro|me deja) (entrar|ingresar|conectarme|unirme)",
    "aceptame|admiteme|dejame entrar|me (aceptas|admites|dejas entrar)",
    "(pedi|solicite|estoy pidiendo|estoy solicitando|le di (a )?(pedir|solicitar)) (permiso|unirme|acceso|entrar)",
    "dice que (espere|me acepten|el organizador)",
  ]
    .map((p) => `\\b(${p})\\b`)
    .join("|")
);

/** ¿Dice que ya está en la sala o esperando que la dejen entrar? */
export const saysWaitingInRoom = (text: string | null | undefined): boolean => {
  const t = foldForSearch(text ?? "").replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  // «Ya estoy» solo, en un mensaje corto.
  return /^(ya estoy|aqui estoy)$/.test(t) || WAITING.test(t);
};

export type ArrivalStep =
  /** Alguien que no es Dayana está en la reunión y Dayana no: avisar. */
  | { kind: "notify"; meetName: string | null }
  /** Dayana ya está: ella ve quién entra. */
  | { kind: "dayana_in" }
  /** Nadie todavía (o ya se fueron todos). */
  | { kind: "nobody" };

export const arrivalStep = (conference: MeetConference | null, dayana: DayanaIdentity): ArrivalStep => {
  const inside = (conference?.participants ?? []).filter((p) => !p.leftAt);
  if (inside.some((p) => isDayana(p, dayana))) return { kind: "dayana_in" };
  const guest = inside.find((p) => !isDayana(p, dayana));
  return guest ? { kind: "notify", meetName: guest.displayName } : { kind: "nobody" };
};

/** El aviso al celular de Dayana. */
export const arrivalNotice = (input: {
  who: string;
  /** La hora de la sesión, ya en la zona de Dayana («3:00 p. m.»). */
  hour: string;
  source: "meet" | "chat";
  /** Cómo aparece en Meet, si no es el mismo nombre. */
  meetName?: string | null;
  /** Lo que escribió, si el aviso viene del chat. */
  quote?: string | null;
}): { title: string; body: string } => {
  const asMeet =
    input.meetName && foldForSearch(input.meetName).trim() !== foldForSearch(input.who).trim() ? ` (en Meet aparece como «${input.meetName}»)` : "";
  if (input.source === "meet") {
    return {
      title: `${input.who} te espera en Meet`,
      body: `Entró a la sala de su sesión de las ${input.hour}${asMeet} y tú todavía no estás.`,
    };
  }
  const quote = input.quote?.replace(/\s+/g, " ").trim().slice(0, 140);
  return {
    title: `${input.who} te espera en la sala`,
    body: `Te escribió${quote ? `: «${quote}»` : " que está esperando"} (sesión de las ${input.hour}). Si pidió permiso para entrar, acepta su solicitud en Meet.`,
  };
};
