/**
 * Los eventos gratuitos en pie en los que la persona ya se inscribió, para
 * CLIENTA EN EL CRM. Pedido de la dueña (16-oct): Pricila, inscrita al webinar
 * del 25, escribió «espero el enlace» y la IA le mandó la página de
 * inscripción (`/eventos-gratuitos`) en vez del enlace de Google Meet.
 *
 * Pura: `clientContext` le pasa las inscripciones de eventos abiertos o
 * cerrados sin terminar. El enlace de la reunión solo va en el contexto de
 * quien se inscribió; a los demás la IA les sigue dando la página para
 * inscribirse (DATOS → EVENTOS GRATUITOS).
 */

export type RegisteredFreeEvent = {
  eventLabel: string;
  headline: string;
  startsAt: Date | null;
  startsAtHasTime: boolean;
  meetUrl: string | null;
};

/** Mismo margen que los DATOS: un evento sigue «en pie» hasta 3 h después de empezar. */
const STILL_ON_MS = 3 * 3600_000;

const whenLabel = (d: Date, withTime: boolean) =>
  `${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" }).format(d)}${
    withTime ? `, ${new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" }).format(d)} hora de Colombia` : ""
  }`;

export const registeredEventLines = (events: RegisteredFreeEvent[], now = Date.now()): string[] =>
  events
    .filter((e) => !e.startsAt || e.startsAt.getTime() > now - STILL_ON_MS)
    .map((e) => {
      const when = e.startsAt ? whenLabel(e.startsAt, e.startsAtHasTime) : "fecha por anunciar";
      const meet = e.meetUrl?.trim();
      return `Ya se inscribió en el evento gratuito: ${e.eventLabel} «${e.headline}» (${when}). ${
        meet
          ? `Si pide el enlace para entrar, dale el de la reunión de Google Meet, tal cual: ${meet} — no la página de inscripción, porque ya se inscribió.`
          : "El enlace de la reunión todavía no está: si lo pide, dile que se lo mandamos por aquí y a su correo antes de empezar. No le mandes la página de inscripción: ya se inscribió."
      }`;
    });
