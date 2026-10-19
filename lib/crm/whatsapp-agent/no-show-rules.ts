import { getTimeLabelInTz } from "@/lib/datetime/zoned-time";
import type { MeetConference } from "@/lib/google/meet";
import { personFirstName } from "@/lib/person-name";
import { fillVars } from "../whatsapp-outbound-plan";
import { foldName } from "./event-title";
import { polishReply } from "./wording";

/**
 * Sesión pagada a la que la persona no entró (pedido de la dueña, 17-oct): a
 * los `afterMin` minutos de empezar (12 por defecto), si Dayana está en la
 * reunión de Meet y nadie más entró, se le manda UN mensaje para reagendar.
 * Dayana sigue agendando ella: el mensaje no ofrece horas.
 *
 * Solo con lo que dice la API de Meet (quién entró y cuándo), nunca con el
 * chat: «ya voy», «ya estoy» no dicen si de verdad entró. Reglas puras; la
 * consulta y el envío están en `no-show.ts`.
 */

/** Pasado esto desde la hora de mandar, si nunca se pudo decidir, se deja. */
export const NO_SHOW_GIVE_UP_MIN = 20;

export const DEFAULT_NO_SHOW_MESSAGE =
  "Hola {{nombre}} 🙏 Dayana te esperó en la sala para tu sesión de hoy a las {{hora}} y no alcanzaste a conectarte. Escríbele por aquí para reagendarla.";

export type NoShowStep =
  /** Todavía no se puede decidir: lo mira la próxima pasada. */
  | { kind: "wait"; reason: "too_early" | "no_conference" | "dayana_not_in" }
  /** La persona entró (o alguien que no es Dayana): no se manda nada. */
  | { kind: "joined" }
  | { kind: "send" }
  /** Pasó el tiempo y Dayana no estaba en la reunión: no se manda. */
  | { kind: "give_up" };

export type DayanaIdentity = { id: string | null; name: string | null };

/** ¿Ese participante de Meet es Dayana (su cuenta, o su nombre si no hay cuenta)? */
export const isDayana = (p: MeetConference["participants"][number], me: DayanaIdentity) =>
  (me.id != null && p.user === `users/${me.id}`) || (me.name != null && p.displayName != null && foldName(p.displayName) === foldName(me.name));

export const noShowStep = (input: {
  startsAt: Date;
  now: Date;
  afterMin: number;
  /** La reunión de esa sesión (`null`: nadie la abrió). */
  conference: MeetConference | null;
  dayana: DayanaIdentity;
}): NoShowStep => {
  const sendAt = input.startsAt.getTime() + input.afterMin * 60_000;
  if (input.now.getTime() < sendAt) return { kind: "wait", reason: "too_early" };
  const late = input.now.getTime() > sendAt + NO_SHOW_GIVE_UP_MIN * 60_000;
  if (!input.conference) return late ? { kind: "give_up" } : { kind: "wait", reason: "no_conference" };
  const people = input.conference.participants;
  if (people.some((p) => !isDayana(p, input.dayana))) return { kind: "joined" };
  if (!people.some((p) => isDayana(p, input.dayana))) return late ? { kind: "give_up" } : { kind: "wait", reason: "dayana_not_in" };
  return { kind: "send" };
};

export const noShowText = (input: { template?: string | null; name: string | null | undefined; startsAt: Date; timeZone: string }): string =>
  polishReply(
    // «{nombre}» con una sola llave también vale (como en el recordatorio).
    fillVars((input.template?.trim() || DEFAULT_NO_SHOW_MESSAGE).replace(/(?<!\{)\{\s*(nombre|hora)\s*\}(?!\})/g, "{{$1}}"), {
      nombre: personFirstName(input.name) ?? "",
      hora: getTimeLabelInTz(input.startsAt, input.timeZone),
    })
  );
