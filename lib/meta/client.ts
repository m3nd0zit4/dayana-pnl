/**
 * Cliente único de la Graph API de Meta.
 *
 * WhatsApp Cloud API, Messenger e Instagram viven en la misma app de Meta y en
 * el mismo host, así que comparten versión, transporte y manejo de errores. La
 * versión está centralizada aquí a propósito: Meta publica una nueva cada ~6
 * meses y soporta cada una ~2 años, así que subirla debe ser una sola línea.
 */

export const META_GRAPH_VERSION =
  process.env.META_GRAPH_VERSION?.trim() || "v23.0";

const GRAPH_HOST = "https://graph.facebook.com";

export type MetaCredentials = {
  /** Id de la cuenta emisora: phone_number_id (WhatsApp) o page id (IG/Messenger). */
  accountId: string;
  token: string;
  /**
   * Por dónde sale WhatsApp. `dialog360` es el socio de Meta que permite la
   * coexistencia (el número sigue en la app del celular y a la vez en la API).
   * Su API es la de Meta con otra dirección y otra cabecera; el resto del
   * código no se entera. Ausente = Meta directo.
   */
  provider?: "meta" | "dialog360";
};

/** Host de la API de 360dialog (mismo formato que la Cloud API de Meta). */
export const DIALOG360_HOST = "https://waba-v2.360dialog.io";

/**
 * `accountId` de las credenciales de 360dialog. La API del socio no lleva el
 * phone_number_id en la ruta (la clave ya identifica el número), así que las
 * rutas `"<id>/messages"` que arma el resto del código se reescriben quitando
 * este prefijo.
 */
export const DIALOG360_ACCOUNT = "dialog360";

type Auth = Pick<MetaCredentials, "token" | "provider">;

/** URL y cabecera de autenticación según el proveedor. */
const endpointFor = (
  path: string,
  credentials: Auth
): { url: string; headers: Record<string, string> } => {
  if (credentials.provider === "dialog360") {
    const rest = path.startsWith(`${DIALOG360_ACCOUNT}/`)
      ? path.slice(DIALOG360_ACCOUNT.length + 1)
      : path;
    return {
      url: `${DIALOG360_HOST}/${rest}`,
      headers: { "D360-API-KEY": credentials.token },
    };
  }
  return {
    url: `${GRAPH_HOST}/${META_GRAPH_VERSION}/${path}`,
    headers: { Authorization: `Bearer ${credentials.token}` },
  };
};

/**
 * Error de la Graph API con el código de Meta intacto.
 *
 * El código importa para diagnosticar: 190 es token caducado, 100 parámetro
 * inválido, 10 fuera de la ventana de 24 h. Perderlo en un string convierte
 * cada fallo en una sesión de adivinanzas.
 */
export class MetaApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly traceId?: string;

  constructor(
    message: string,
    init: { status: number; code?: number; subcode?: number; traceId?: string }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.status = init.status;
    this.code = init.code;
    this.subcode = init.subcode;
    this.traceId = init.traceId;
  }

  /** Token caducado o revocado — hay que regenerarlo, reintentar no sirve. */
  get isAuthError(): boolean {
    return this.code === 190 || this.status === 401;
  }

  /** Meta pide bajar el ritmo; el llamante puede reintentar más tarde. */
  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 4 || this.code === 613;
  }
}

type GraphErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

const readGraphError = async (
  res: Response
): Promise<{ message: string; body: GraphErrorBody }> => {
  const raw = await res.text();
  try {
    const body = JSON.parse(raw) as GraphErrorBody;
    return { message: body.error?.message ?? raw, body };
  } catch {
    return { message: raw, body: {} };
  }
};

/**
 * POST a la Graph API. Devuelve el JSON ya parseado o lanza `MetaApiError`.
 *
 * `path` es relativo a la versión, sin barra inicial: `"1234/messages"`.
 */
export const graphPost = async <T>(
  path: string,
  payload: unknown,
  credentials: Auth
): Promise<T> => {
  const endpoint = endpointFor(path, credentials);
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      ...endpoint.headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const { message, body } = await readGraphError(res);
    throw new MetaApiError(message, {
      status: res.status,
      code: body.error?.code,
      subcode: body.error?.error_subcode,
      traceId: body.error?.fbtrace_id,
    });
  }

  return (await res.json()) as T;
};

/**
 * POST multipart a la Graph API — subida de medios (WhatsApp `/media`,
 * adjuntos binarios de Messenger/Instagram). Sin `Content-Type` manual: fetch
 * lo fija con el boundary correcto a partir del `FormData`.
 */
export const graphPostForm = async <T>(
  path: string,
  form: FormData,
  credentials: Auth
): Promise<T> => {
  const endpoint = endpointFor(path, credentials);
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: endpoint.headers,
    body: form,
  });

  if (!res.ok) {
    const { message, body } = await readGraphError(res);
    throw new MetaApiError(message, {
      status: res.status,
      code: body.error?.code,
      subcode: body.error?.error_subcode,
      traceId: body.error?.fbtrace_id,
    });
  }

  return (await res.json()) as T;
};

/** GET a la Graph API — perfiles de usuario y metadatos de adjuntos. */
export const graphGet = async <T>(
  path: string,
  params: Record<string, string>,
  credentials: Auth
): Promise<T> => {
  const search = new URLSearchParams(params).toString();
  const suffix = search ? `?${search}` : "";
  const endpoint = endpointFor(path, credentials);
  const res = await fetch(`${endpoint.url}${suffix}`, {
    headers: endpoint.headers,
  });

  if (!res.ok) {
    const { message, body } = await readGraphError(res);
    throw new MetaApiError(message, {
      status: res.status,
      code: body.error?.code,
      subcode: body.error?.error_subcode,
      traceId: body.error?.fbtrace_id,
    });
  }

  return (await res.json()) as T;
};

/**
 * Descarga un adjunto usando el token de la app.
 *
 * Las URLs de medios de Meta caducan, así que el flujo de entrada las baja y
 * las rehospeda; esto es solo el paso de descarga.
 */
export const graphFetchMedia = async (
  url: string,
  credentials: Auth
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> => {
  // 360dialog sirve los medios por su propio host: la URL que devuelve es la
  // de Meta (lookaside.fbsbx.com) y hay que pedirla a través del socio.
  const res =
    credentials.provider === "dialog360"
      ? await fetch(url.replace(/^https:\/\/lookaside\.fbsbx\.com/, DIALOG360_HOST), {
          headers: { "D360-API-KEY": credentials.token },
        })
      : await fetch(url, {
          headers: { Authorization: `Bearer ${credentials.token}` },
        });
  if (!res.ok) {
    console.warn("[meta] media download failed", res.status, url);
    return null;
  }
  return {
    buffer: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
};

// ── Configuración ──────────────────────────────────────────────────────────

const readEnv = (name: string): string | null =>
  process.env[name]?.trim() || null;

/** Credenciales de WhatsApp Cloud API, o null si no está configurada. */
export const whatsAppCredentials = (): MetaCredentials | null => {
  const accountId = readEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = readEnv("WHATSAPP_API_TOKEN");
  return accountId && token ? { accountId, token } : null;
};

/**
 * Credenciales de la Página, que sirven **a la vez** para Messenger y para
 * Instagram: al estar la cuenta de IG vinculada a la Página, un único token
 * cubre los dos canales y un único endpoint los atiende.
 */
export const pageCredentials = (): MetaCredentials | null => {
  const accountId = readEnv("META_PAGE_ID");
  const token = readEnv("META_PAGE_ACCESS_TOKEN");
  return accountId && token ? { accountId, token } : null;
};

/** Id de la cuenta profesional de Instagram, para reconocer al destinatario. */
export const instagramAccountId = (): string | null =>
  readEnv("META_INSTAGRAM_ID");

/** Interruptor de la bandeja, igual que `CRM_AGENT_ENABLED` para el agente. */
export const isMetaInboxEnabled = (): boolean =>
  process.env.META_INBOX_ENABLED === "true";
