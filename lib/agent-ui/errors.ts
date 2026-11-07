/**
 * Why a turn failed, in a sentence Dayana can act on. Pure (errors.test.ts).
 */

type EventLike = { type: string; data?: unknown };

/** The message of the newest failure event in the log, if any. */
export const lastFailureMessage = (events: readonly EventLike[]): string | null => {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "turn.failed" || event.type === "session.failed" || event.type === "step.failed") {
      const message = (event.data as { message?: unknown } | undefined)?.message;
      return typeof message === "string" && message.trim() ? message.trim() : null;
    }
    // A later successful boundary means the failure was already recovered.
    if (event.type === "turn.completed") return null;
  }
  return null;
};

const RULES: [RegExp, string][] = [
  [/quota|resource.?exhausted|429|rate.?limit|too many requests/i, "El modelo llegó a su límite por ahora. Espera un minuto y reinténtalo."],
  [/failed to fetch|network|fetch failed|econnreset|socket|load failed|aborted/i, "Se cortó la conexión con el asistente."],
  [/timed? ?out|timeout|deadline/i, "El asistente tardó demasiado en responder."],
  [/401|403|unauthori[sz]ed|forbidden|sesión|session expired/i, "Tu sesión del CRM expiró. Recarga la página e inténtalo de nuevo."],
  [/blocked|prohibited|safety|blockReason/i, "El proveedor del modelo bloqueó esta respuesta."],
  [/5\d\d|internal server error|service unavailable|bad gateway/i, "El servidor del asistente falló."],
];

const MAX_RAW = 180;

/**
 * Known causes get a plain Spanish sentence; anything else shows the raw
 * message (cut) so the reason is never hidden; null when nothing is known.
 */
export const describeAgentError = (message: string | null | undefined): string | null => {
  const raw = message?.trim();
  if (!raw) return null;
  for (const [re, text] of RULES) if (re.test(raw)) return text;
  return raw.length > MAX_RAW ? `${raw.slice(0, MAX_RAW - 1)}…` : raw;
};
