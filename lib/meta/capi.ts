import { META_GRAPH_VERSION, MetaApiError } from "./client";
import { resolveCapiCredentials } from "./capi-credentials";
import {
  hashCountry,
  hashEmail,
  hashName,
  hashPhone,
} from "./capi-hash";

/**
 * Conversions API (envío servidor→servidor).
 *
 * Complementa al Pixel, no lo sustituye: el navegador pierde eventos por
 * bloqueadores y restricciones de cookies, y esto los recupera. Meta
 * recomienda expresamente tener los dos.
 *
 * La deduplicación es lo crítico: el mismo evento llega dos veces (una por el
 * navegador y otra por aquí) y Meta solo lo cuenta una vez si AMBOS mandan el
 * mismo `event_id`. Si se rompe, todas las métricas de campaña quedan infladas
 * al doble y nadie se entera hasta que las decisiones ya se tomaron.
 */

const GRAPH_HOST = "https://graph.facebook.com";

export type CapiUserData = {
  email?: string | null;
  phoneE164?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  countryIso?: string | null;
  /** Solo si el evento nace de una petición real del visitante. */
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  /** Cookies `_fbp` / `_fbc` del navegador: suben mucho la calidad de match. */
  fbp?: string | null;
  fbc?: string | null;
};

export type CapiEvent = {
  eventName: "Purchase" | "Lead" | "InitiateCheckout" | "CompleteRegistration";
  /** DEBE coincidir con el `eventID` del Pixel. Ver nota de deduplicación. */
  eventId: string;
  eventTime: Date;
  eventSourceUrl?: string;
  userData: CapiUserData;
  customData?: Record<string, unknown>;
};

/** Quita claves nulas: Meta rechaza `user_data` con valores vacíos. */
const compact = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v != null && v !== "")
  ) as Partial<T>;

const buildUserData = (user: CapiUserData) =>
  compact({
    em: hashEmail(user.email),
    ph: hashPhone(user.phoneE164),
    fn: hashName(user.firstName),
    ln: hashName(user.lastName),
    country: hashCountry(user.countryIso),
    // IP y user-agent van SIN hashear: Meta los espera en claro.
    client_ip_address: user.clientIpAddress,
    client_user_agent: user.clientUserAgent,
    fbp: user.fbp,
    fbc: user.fbc,
  });

export type CapiResult =
  | { sent: true; eventsReceived: number }
  | { sent: false; reason: "not_configured" | "no_match_keys" };

/**
 * Envía un evento. Lanza `MetaApiError` si Meta responde error — el llamante
 * (un step de Inngest) decide si reintentar.
 */
export const sendCapiEvent = async (event: CapiEvent): Promise<CapiResult> => {
  const credentials = await resolveCapiCredentials();
  if (!credentials) return { sent: false, reason: "not_configured" };

  const userData = buildUserData(event.userData);

  // Sin ninguna clave de match el evento no se puede atribuir a nadie: Meta lo
  // acepta y lo descarta en silencio, así que es mejor no gastar la llamada.
  const hasMatchKey = ["em", "ph", "fn", "ln", "fbp", "fbc"].some(
    (k) => k in userData
  );
  if (!hasMatchKey) return { sent: false, reason: "no_match_keys" };

  const payload = {
    data: [
      compact({
        event_name: event.eventName,
        event_id: event.eventId,
        // Meta espera segundos, no milisegundos.
        event_time: Math.floor(event.eventTime.getTime() / 1000),
        event_source_url: event.eventSourceUrl,
        action_source: "website",
        user_data: userData,
        custom_data: event.customData,
      }),
    ],
    ...(credentials.testEventCode
      ? { test_event_code: credentials.testEventCode }
      : {}),
  };

  const res = await fetch(
    `${GRAPH_HOST}/${META_GRAPH_VERSION}/${credentials.pixelId}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    let code: number | undefined;
    let subcode: number | undefined;
    let traceId: string | undefined;
    try {
      const body = JSON.parse(raw) as {
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          fbtrace_id?: string;
        };
      };
      message = body.error?.message ?? raw;
      code = body.error?.code;
      subcode = body.error?.error_subcode;
      traceId = body.error?.fbtrace_id;
    } catch {
      /* respuesta no-JSON: se conserva el texto crudo */
    }
    throw new MetaApiError(message, {
      status: res.status,
      code,
      subcode,
      traceId,
    });
  }

  const body = (await res.json()) as { events_received?: number };
  return { sent: true, eventsReceived: body.events_received ?? 0 };
};

/**
 * `event_id` del Purchase — derivado del id del pago.
 *
 * Determinista a propósito: el servidor lo calcula en Inngest y la página
 * `/pago/exito` calcula exactamente el mismo string para el Pixel, sin
 * coordinarse por ningún canal. No sirve la referencia de checkout
 * (`chk:<contactId>:<planId>`) porque se repite entre intentos.
 */
export const purchaseEventId = (paymentId: string): string =>
  `purchase.${paymentId}`;

/**
 * `event_id` del Lead — derivado del id del diagnóstico.
 *
 * Se usa el **id** y no el token: el token va en la URL del resultado y se
 * comparte por WhatsApp. No es un secreto, pero no hay motivo para que lo sea
 * menos.
 *
 * A diferencia del Purchase, el navegador no puede calcularlo solo: la fila la
 * crea el servidor durante el envío. Por eso `/api/leads` lo devuelve en la
 * respuesta y el asistente se lo pasa al Pixel. Si esa cadena se rompe, el Lead
 * se cuenta dos veces y el coste por lead de cada campaña aparece a la mitad de
 * lo real — peor que no medirlo, porque parece una buena noticia.
 */
export const leadEventId = (diagnosticId: string): string =>
  `lead.${diagnosticId}`;
