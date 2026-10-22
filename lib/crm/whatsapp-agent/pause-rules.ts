import { foldForSearch } from "../search-normalize";
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

/**
 * Un riesgo de verdad en el motivo de la escalada: hacerse daño, no querer
 * vivir, violencia, abuso, o el modelo mismo dice «crisis».
 */
const RISK = new RegExp(
  [
    "suicid",
    "quitar(me|se|le)?\\s+la\\s+vida",
    "no\\s+(quiero|quiere|quisiera|queria)\\s+(vivir|seguir|existir|estar\\s+aqui)",
    "ganas\\s+de\\s+morir",
    "(quiero|quiere|quisiera)\\s+morir",
    "morirme",
    "matarme",
    "matarse",
    "mejor\\s+muert[oa]",
    "ir(me|se)?\\s+de\\s+este\\s+mundo",
    "desaparecer",
    "acabar\\s+con\\s+(todo|mi\\s+vida|esto)",
    "que\\s+todo\\s+(termine|se\\s+acabe)",
    "ya\\s+no\\s+aguanto",
    "no\\s+aguanto\\s+mas",
    "(hacer|hacerme|hacerse|haga|hace)\\s+dano",
    "autolesi",
    "cortarme",
    "cortarse",
    "lastimarme",
    "lastimarse",
    "pastillas",
    "violen",
    "violaci",
    "abus[oa]",
    "maltrat",
    "golpe",
    "me\\s+pega",
    "amenaz",
    "\\bcrisis\\b",
    "emergencia",
    "peligro",
  ].join("|")
);

/** ¿Algún texto (lo que escribió ella, el motivo de la escalada) trae un riesgo de verdad? */
export const hasRiskSigns = (texts: (string | null | undefined)[]): boolean => texts.some((t) => Boolean(t) && RISK.test(foldForSearch(t!)));

/**
 * ¿Es una crisis (la IA se calla hasta que Dayana la suelte)? Algo urgente, o
 * algo clínico con un riesgo en el motivo. Lo que la persona siente
 * (angustia, ansiedad, duelo, insomnio) es lo que Dayana trabaja y no calla a
 * la IA: Joselyn (21-oct) contó su angustia por su hermana enferma, la IA lo
 * escaló como «clinical» (el prompt dice que no) y quedó callada 6 días,
 * aunque Dayana encendió «La IA responde siempre». Sin motivo, clínico sigue
 * siendo crisis: no se sabe.
 */
export const isCrisis = (e: { category: string | null; severity: string | null; reason: string | null | undefined }): boolean =>
  e.severity === "urgent" || (e.category === "clinical" && (!e.reason?.trim() || RISK.test(foldForSearch(e.reason))));

export const pauseHolds = (p: PauseState, switches: PauseSwitches): boolean => {
  // Una crisis sigue apartando a la IA aunque Dayana ya haya contestado (la
  // escalada pasó a pausa humana): se suelta a mano («Devolver a la IA»).
  if (isCrisis({ category: p.escalationCategory, severity: p.escalationSeverity, reason: p.escalationReason })) return true;
  if (p.reason === "escalation") {
    if (isManualPause({ category: p.escalationCategory, reason: p.escalationReason })) return true;
    return switches.onEscalation;
  }
  // `human` (o una pausa vieja sin motivo).
  return switches.onHumanReply;
};

/** ¿Escalar esto calla a la IA en el chat? Lo delicado siempre; lo demás, según el interruptor. */
export const escalationPauses = (e: { category: string; severity: string; reason: string | null | undefined }, switches: PauseSwitches): boolean =>
  isCrisis(e) || switches.onEscalation;
