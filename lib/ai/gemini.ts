import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Las claves de Gemini, con respaldo: si una se queda sin créditos o sin cuota
 * (o Google la bloquea), la misma llamada se repite con la siguiente.
 *
 * Por qué (2026-10-16): la clave de producción se quedó sin créditos
 * prepagados (402) y la IA dejó de contestar en WhatsApp toda la mañana. El
 * dueño creó otra clave en otro proyecto de Google: con las dos, si una falla
 * la otra contesta.
 *
 * Las claves vienen del entorno (las pega la dueña en Vercel, nunca en git):
 * `GEMINI_API_KEY` (la principal), `GEMINI_API_KEY_2` y, para más,
 * `GEMINI_API_KEYS` separadas por comas. Una clave que falló por créditos se
 * deja de lado un rato (`COOLDOWN_MS`) para no gastar una vuelta en ella cada
 * vez; si todas fallaron, se intentan igual (puede que ya se recargaron).
 */

export const geminiKeys = (env: Record<string, string | undefined> = process.env): string[] => {
  const all = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2, ...(env.GEMINI_API_KEYS ?? "").split(",")]
    .map((k) => k?.trim() ?? "")
    .filter(Boolean);
  return [...new Set(all)];
};

/** ¿Hay alguna clave? */
export const hasGeminiKey = (): boolean => geminiKeys().length > 0;

/**
 * Errores por los que vale la pena probar otra clave: sin créditos (402), sin
 * cuota o demasiadas llamadas (429), clave bloqueada o sin permiso (403), o
 * una clave que Google ya no acepta (400 `API_KEY_INVALID`, se mira el cuerpo).
 */
const COOLDOWN_MS: Record<number, number> = { 402: 30 * 60_000, 403: 30 * 60_000, 400: 30 * 60_000, 429: 60_000 };

/** Hasta cuándo se deja de lado cada clave (solo en esta instancia). */
const benchedUntil = new Map<string, number>();

/** Para las pruebas. */
export const resetGeminiKeyState = () => benchedUntil.clear();

const headerName = "x-goog-api-key";

/** Un `fetch` (sin los extras de Bun como `preconnect`): lo que pide el proveedor. */
export type GeminiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const withKey = (headers: HeadersInit | undefined, key: string): Headers => {
  const h = new Headers(headers);
  h.set(headerName, key);
  return h;
};

const switchable = async (res: Response): Promise<boolean> => {
  if (res.status === 402 || res.status === 403 || res.status === 429) return true;
  if (res.status !== 400) return false;
  const text = await res
    .clone()
    .text()
    .catch(() => "");
  return /API_KEY_INVALID|API key not valid|API key expired/i.test(text);
};

/**
 * `fetch` para el proveedor de Google: prueba las claves en orden (primero las
 * que no están de lado) y se queda con la primera respuesta que no sea de
 * créditos/cuota/clave. Si todas fallan, devuelve la última respuesta (el
 * error de siempre llega a quien llamó).
 */
export const createGeminiFetch =
  (opts: { keys?: () => string[]; baseFetch?: GeminiFetch; now?: () => number } = {}): GeminiFetch =>
  async (input, init) => {
    const keys = (opts.keys ?? geminiKeys)();
    const baseFetch: GeminiFetch = opts.baseFetch ?? ((i, o) => fetch(i, o));
    const now = (opts.now ?? Date.now)();
    // Un cuerpo que no se puede volver a leer (un stream) no se reintenta.
    const body = init?.body;
    const retryable = body == null || typeof body === "string";
    if (keys.length <= 1 || !retryable) return baseFetch(input, init);

    const fresh = keys.filter((k) => (benchedUntil.get(k) ?? 0) <= now);
    const order = fresh.length ? [...fresh, ...keys.filter((k) => !fresh.includes(k))] : keys;
    let last: Response | null = null;
    for (const [i, key] of order.entries()) {
      const res = await baseFetch(input, { ...init, headers: withKey(init?.headers, key) });
      if (!(await switchable(res))) {
        benchedUntil.delete(key);
        return res;
      }
      benchedUntil.set(key, now + (COOLDOWN_MS[res.status] ?? 60_000));
      if (i < order.length - 1) {
        console.warn(`[gemini] la clave ${i + 1} de ${order.length} falló (${res.status}): pruebo la siguiente`);
      }
      last = res;
    }
    return last as Response;
  };

const geminiFetch = createGeminiFetch();

/**
 * El proveedor de Google con todas las claves. Úsalo en lugar de
 * `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })`.
 */
// El tipo de `fetch` del proveedor trae los extras de Bun (`preconnect`); el nuestro no los usa.
export const geminiProvider = () => createGoogleGenerativeAI({ apiKey: geminiKeys()[0], fetch: geminiFetch as typeof fetch });
