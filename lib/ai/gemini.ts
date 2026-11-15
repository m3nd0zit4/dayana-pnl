import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { modelFromUrl, observeAiUsage, recordAiUsage, usageFromResponseText, type AiUsage } from "./usage";

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

type GeminiFetchOptions = {
  keys?: () => string[];
  baseFetch?: GeminiFetch;
  now?: () => number;
  /**
   * Recibe los tokens de cada respuesta que llega a quien llamó (ver
   * `./usage.ts`). Sin él no se anota nada: las pruebas no lo pasan.
   */
  onUsage?: (usage: AiUsage) => void;
};

/**
 * `fetch` para el proveedor de Google: prueba las claves en orden (primero las
 * que no están de lado) y se queda con la primera respuesta que no sea de
 * créditos/cuota/clave. Si todas fallan, devuelve la última respuesta (el
 * error de siempre llega a quien llamó). Dice también con qué clave salió.
 */
const createKeyedFetch =
  (opts: GeminiFetchOptions) =>
  async (input: RequestInfo | URL, init?: RequestInit): Promise<{ res: Response; key: string | null }> => {
    const keys = (opts.keys ?? geminiKeys)();
    const baseFetch: GeminiFetch = opts.baseFetch ?? ((i, o) => fetch(i, o));
    const now = (opts.now ?? Date.now)();
    // Un cuerpo que no se puede volver a leer (un stream) no se reintenta.
    const body = init?.body;
    const retryable = body == null || typeof body === "string";
    if (keys.length <= 1 || !retryable) return { res: await baseFetch(input, init), key: keys[0] ?? null };

    const fresh = keys.filter((k) => (benchedUntil.get(k) ?? 0) <= now);
    const order = fresh.length ? [...fresh, ...keys.filter((k) => !fresh.includes(k))] : keys;
    let last: { res: Response; key: string } | null = null;
    for (const [i, key] of order.entries()) {
      const res = await baseFetch(input, { ...init, headers: withKey(init?.headers, key) });
      if (!(await switchable(res))) {
        benchedUntil.delete(key);
        return { res, key };
      }
      benchedUntil.set(key, now + (COOLDOWN_MS[res.status] ?? 60_000));
      if (i < order.length - 1) {
        console.warn(`[gemini] la clave ${i + 1} de ${order.length} falló (${res.status}): pruebo la siguiente`);
      }
      last = { res, key };
    }
    return last as { res: Response; key: string };
  };

/**
 * Lee el cuerpo UNA vez y devuelve una respuesta nueva con ese mismo texto. Antes se
 * leían copias (`res.clone()`) para ver si Google bloqueó el pedido y para anotar los
 * tokens; en Bun eso a veces dejaba vacío el cuerpo que leía el SDK («Invalid JSON
 * response… JSON parsing failed: Text: .»: 18 de 231 respuestas en la evaluación del
 * 13-nov, y todas en cuanto se añadió una copia más el 14-nov). Sin copias no pasa.
 */
type ReadResponse = { res: Response; text: string };
const readOnce = async (res: Response): Promise<ReadResponse> => {
  const text = await res.text().catch(() => "");
  const headers = new Headers(res.headers);
  // El texto ya viene descomprimido: sin estas cabeceras nadie intenta descomprimirlo otra vez.
  headers.delete("content-encoding");
  headers.delete("content-length");
  return { text, res: new Response(text, { status: res.status, statusText: res.statusText, headers }) };
};

/**
 * Google a veces bloquea el pedido entero: contesta 200 sin `candidates`, solo
 * con `promptFeedback.blockReason`. Este SDK (@ai-sdk/google 4.0.29) no lo
 * entiende y lanza «Invalid JSON response» (Andrea y Sil, 23/24-oct: la IA no
 * contestaba y el mismo pedido se repetía cada vez). Devuelve el cuerpo y el
 * motivo, o null si no es eso.
 */
const blockedPrompt = (r: ReadResponse): { body: Record<string, unknown>; reason: string } | null => {
  if (r.res.status !== 200) return null;
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(r.text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || (Array.isArray(body.candidates) && body.candidates.length > 0)) return null;
  if (!("promptFeedback" in body) && !("usageMetadata" in body)) return null;
  const reason = (body.promptFeedback as { blockReason?: unknown } | undefined)?.blockReason;
  return { body, reason: typeof reason === "string" && reason ? reason : "OTHER" };
};

/** Un 200 sin nada en el cuerpo: el SDK lo lee como «Invalid JSON response». */
const emptyOk = (r: ReadResponse): boolean => r.res.status === 200 && !r.text.trim();

/** El mismo pedido con el modelo completo en vez del «-lite» (o null si no hay otro). */
const fullModelUrl = (url: string): string | null => {
  const m = /\/models\/([^/:]+)-lite:generateContent/.exec(url);
  return m ? url.replace(`/models/${m[1]}-lite:`, `/models/${m[1]}:`) : null;
};

/**
 * Con las claves de respaldo y, si Google bloquea el pedido, otra vuelta con el
 * modelo completo (la misma clave) y después con cada una de las otras claves
 * que no estén de lado (otro proyecto de Google: en dev, con la misma config,
 * Google nunca lo bloqueó). Si todo sale bloqueado, el SDK recibe una respuesta
 * vacía con el motivo (`finishReason` y `promptFeedback`): quien llamó ve que
 * no hubo texto, en lugar de un error.
 */
export const createGeminiFetch = (opts: GeminiFetchOptions = {}): GeminiFetch => {
  const keyed = createKeyedFetch(opts);
  // Se anota lo que de verdad se devuelve, con la dirección que lo contestó:
  // si el «-lite» salió bloqueado y respondió el modelo completo, los tokens
  // son del completo. Los intentos descartados por el camino y la respuesta
  // vacía de «todo bloqueado» no se anotan: no llegó texto a nadie.
  const answered = (answeredUrl: string, res: Response): Response => {
    if (opts.onUsage) observeAiUsage(answeredUrl, res, opts.onUsage);
    return res;
  };
  // Lo mismo con el texto ya leído (sin copias).
  const answeredRead = (answeredUrl: string, r: ReadResponse): Response => {
    if (opts.onUsage && r.res.ok) {
      const model = modelFromUrl(answeredUrl);
      const usage = model ? usageFromResponseText(model, r.text) : null;
      if (usage) opts.onUsage(usage);
    }
    return r.res;
  };
  return async (input, init) => {
    const first = await keyed(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes(":generateContent")) return answered(url, first.res);
    let key = first.key;
    let read = await readOnce(first.res);
    // Un 200 con el cuerpo vacío: se repite el mismo pedido, hasta dos veces.
    const repeatable = !(input instanceof Request) && (init?.body == null || typeof init.body === "string");
    for (let attempt = 0; repeatable && attempt < 2 && emptyOk(read); attempt++) {
      console.warn(`[gemini] respuesta vacía de Google: repito el pedido (${attempt + 1})`);
      const again = await keyed(input, init);
      key = again.key;
      read = await readOnce(again.res);
    }
    const blocked = blockedPrompt(read);
    if (!blocked) return answeredRead(url, read);
    console.warn(`[gemini] Google bloqueó el pedido (${blocked.reason}): ${JSON.stringify(blocked.body).slice(0, 800)}`);

    // Solo se repite lo que se puede repetir igual: URL + cuerpo de texto.
    const retryable = repeatable;
    const baseFetch: GeminiFetch = opts.baseFetch ?? ((i, o) => fetch(i, o));
    const now = (opts.now ?? Date.now)();
    const keys = (opts.keys ?? geminiKeys)();
    const send = (u: string, k: string | null) => baseFetch(u, k ? { ...init, headers: withKey(init?.headers, k) } : init);
    const other = fullModelUrl(url);
    const retries: { label: string; url: string; run: () => Promise<Response> }[] = retryable
      ? [
          ...(other ? [{ label: "el modelo completo", url: other, run: () => send(other, key) }] : []),
          ...keys
            .filter((k) => k !== key && (benchedUntil.get(k) ?? 0) <= now)
            .map((k) => ({ label: `la clave ${keys.indexOf(k) + 1}`, url, run: () => send(url, k) })),
        ]
      : [];
    // Un error pasajero (cuota, caída) llega tal cual si nada contestó: el SDK reintenta.
    let transient: Response | null = null;
    for (const retry of retries) {
      const r = await readOnce(await retry.run());
      if (r.res.ok && !emptyOk(r) && !blockedPrompt(r)) {
        console.warn(`[gemini] contestó con ${retry.label}`);
        return answeredRead(retry.url, r);
      }
      console.warn(`[gemini] tampoco con ${retry.label} (${r.res.status})`);
      if ((r.res.status === 429 || r.res.status >= 500) && !transient) transient = r.res;
    }
    if (transient) return transient;
    const promptFeedback = { ...(blocked.body.promptFeedback as object | undefined), blockReason: blocked.reason };
    return new Response(
      JSON.stringify({ ...blocked.body, promptFeedback, candidates: [{ content: { parts: [] }, finishReason: blocked.reason }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
};

const geminiFetch = createGeminiFetch({ onUsage: recordAiUsage });

/**
 * El proveedor de Google con todas las claves. Úsalo en lugar de
 * `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })`.
 */
// El tipo de `fetch` del proveedor trae los extras de Bun (`preconnect`); el nuestro no los usa.
export const geminiProvider = () => createGoogleGenerativeAI({ apiKey: geminiKeys()[0], fetch: geminiFetch as typeof fetch });
