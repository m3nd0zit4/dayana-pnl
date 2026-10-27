import { META_GRAPH_VERSION } from "./client";

/**
 * El token de la Conversions API que Dayana pega en Ajustes.
 *
 * Aquí vive lo que no toca la base de datos: limpiar lo que llega del
 * portapapeles y preguntarle a Meta si lo reconoce. Guardarlo es de
 * `capi-credentials.ts`.
 */

const GRAPH_HOST = "https://graph.facebook.com";

/** Los tokens reales de Meta rondan los 200 caracteres. */
const MIN_LENGTH = 40;
const MAX_LENGTH = 600;

export type CapiTokenInputIssue =
  | "empty"
  | "spaces"
  | "too_short"
  | "too_long"
  | "characters";

export const CAPI_TOKEN_INPUT_MESSAGES: Record<CapiTokenInputIssue, string> = {
  empty: "Pega el token antes de guardar.",
  spaces:
    "Lo pegado tiene espacios o varias líneas. Copia solo el token, sin nada más.",
  too_short:
    "Eso es demasiado corto para ser un token de Meta. Revisa que copiaste todo.",
  too_long: "Eso es demasiado largo para ser un token. Copia solo el token.",
  characters:
    "El token trae caracteres que no le corresponden. Cópialo de nuevo desde Meta.",
};

export type CapiTokenInput =
  | { ok: true; token: string }
  | { ok: false; issue: CapiTokenInputIssue };

/**
 * Quita lo que el portapapeles suele arrastrar (comillas, «Bearer ») y
 * rechaza lo que claramente no es un token. No exige el prefijo `EAA`: Meta
 * ya ha cambiado el formato antes y rechazar uno bueno es peor que dejar que
 * `checkCapiToken` lo pruebe.
 */
export const parseCapiTokenInput = (raw: string): CapiTokenInput => {
  let value = raw.trim();
  if (value === "") return { ok: false, issue: "empty" };

  value = value.replace(/^(["'`])([\s\S]*)\1$/, "$2").trim();
  value = value.replace(/^bearer(\s+|$)/i, "").trim();

  if (value === "") return { ok: false, issue: "empty" };
  if (/\s/.test(value)) return { ok: false, issue: "spaces" };
  if (value.length < MIN_LENGTH) return { ok: false, issue: "too_short" };
  if (value.length > MAX_LENGTH) return { ok: false, issue: "too_long" };
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    return { ok: false, issue: "characters" };
  }
  return { ok: true, token: value };
};

export type CapiTokenCheck =
  /** Meta lo reconoce. No prueba que tenga permiso sobre el píxel. */
  | { state: "valid" }
  /** Meta lo rechaza (190 / 401): caducado, revocado o mal copiado. */
  | { state: "invalid"; message: string }
  /** No se pudo saber: Meta caído, red, o un error que no habla del token. */
  | { state: "unknown"; message: string };

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/**
 * Pregunta a Meta quién es el dueño del token (`GET /me`). Es de solo
 * lectura: no manda ningún evento ni toca el conjunto de datos.
 *
 * Solo `invalid` es definitivo; con `unknown` el llamante decide (al guardar
 * se guarda igual, porque un Meta caído no debe impedir pegar un token bueno).
 */
export const checkCapiToken = async (
  token: string,
  doFetch: FetchLike = fetch as unknown as FetchLike
): Promise<CapiTokenCheck> => {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`${GRAPH_HOST}/${META_GRAPH_VERSION}/me?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { state: "unknown", message: "No pude hablar con Meta ahora." };
  }

  if (res.ok) return { state: "valid" };

  let code: number | undefined;
  let message = "";
  try {
    const body = JSON.parse(await res.text()) as {
      error?: { code?: number; message?: string };
    };
    code = body.error?.code;
    message = body.error?.message ?? "";
  } catch {
    /* respuesta que no es JSON: se queda sin código */
  }

  if (code === 190 || res.status === 401) {
    return {
      state: "invalid",
      message:
        "Meta no reconoce ese token: está caducado, revocado o mal copiado.",
    };
  }
  return {
    state: "unknown",
    message: message
      ? `Meta respondió algo que no habla del token: ${message.split(token).join("…")}`
      : "Meta respondió con un error y no pude comprobar el token.",
  };
};
