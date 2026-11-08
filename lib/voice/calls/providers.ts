import { callOpeningTwiml, twilioCallForm } from "./twiml";

/**
 * Proveedores de llamada detrás de un solo interruptor (`agent.voice.calls`,
 * apagado por defecto). Cada uno recibe lo mismo y devuelve lo mismo; el resto
 * del CRM no sabe por dónde salió la llamada.
 *
 * - `fake`: no llama a nadie. Registra la llamada y devuelve un id. Para
 *   probar el flujo entero (aprobación, auditoría, panel) sin gastar.
 * - `twilio` (opción B): llamada telefónica normal. Usa la cuenta de Twilio que
 *   ya existe para los SMS; solo falta un número con voz.
 * - `whatsapp` (opción A): API de llamadas de WhatsApp desde un segundo número
 *   solo-Cloud-API. La llamada necesita un puente de medios WebRTC (LiveKit u
 *   otro) que entregue la oferta SDP y lleve el audio al modelo; Vercel no puede
 *   ser ese puente. Aquí está la petición a Meta, lista, y el puente es una URL.
 */

export type CallRequest = {
  /** E.164 de Dayana. */
  to: string;
  /** Lo que el asistente dice al contestar. */
  message: string;
  /** Clave de esta llamada: viaja en la URL del webhook para saber de qué llamada es la respuesta. */
  callKey: string;
  /** Base pública del sitio (los webhooks). */
  baseUrl: string;
};

export type CallPlaced = { providerCallId: string; status: string };

export class CallNotConfiguredError extends Error {
  readonly missing: string[];
  constructor(provider: string, missing: string[]) {
    super(`Las llamadas por ${provider} no están configuradas: falta ${missing.join(", ")}.`);
    this.name = "CallNotConfiguredError";
    this.missing = missing;
  }
}

export class CallProviderError extends Error {}

export type CallProvider = {
  id: "fake" | "twilio" | "whatsapp";
  /** Variables de entorno que faltan (vacío = listo). Nunca devuelve sus valores. */
  missing: () => string[];
  place: (req: CallRequest) => Promise<CallPlaced>;
};

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── fake ────────────────────────────────────────────────────────────────

export const fakeCalls: CallPlaced[] = [];

export const fakeProvider = (): CallProvider => ({
  id: "fake",
  missing: () => [],
  place: async (req) => {
    const placed = { providerCallId: `fake-${req.callKey}`, status: "simulated" };
    fakeCalls.push(placed);
    return placed;
  },
});

// ── Twilio (opción B) ──────────────────────────────────────────────────

export const agentCallWebhookUrl = (baseUrl: string, callKey: string, step: "gather" | "status") =>
  `${baseUrl.replace(/\/$/, "")}/api/webhooks/twilio/agent-call?c=${encodeURIComponent(callKey)}&s=${step}`;

const twilioFrom = (env: Env) => env.TWILIO_VOICE_FROM_NUMBER?.trim() || env.TWILIO_FROM_NUMBER?.trim() || "";

export const twilioProvider = (env: Env = process.env, fetchImpl: FetchLike = (i, o) => fetch(i, o)): CallProvider => {
  const missing = () =>
    [
      !env.TWILIO_ACCOUNT_SID?.trim() && "TWILIO_ACCOUNT_SID",
      !env.TWILIO_AUTH_TOKEN?.trim() && "TWILIO_AUTH_TOKEN",
      !twilioFrom(env) && "TWILIO_VOICE_FROM_NUMBER",
    ].filter(Boolean) as string[];
  return {
    id: "twilio",
    missing,
    place: async (req) => {
      const gaps = missing();
      if (gaps.length) throw new CallNotConfiguredError("Twilio", gaps);
      const sid = env.TWILIO_ACCOUNT_SID!.trim();
      const form = twilioCallForm({
        to: req.to,
        from: twilioFrom(env),
        twiml: callOpeningTwiml({ message: req.message, gatherUrl: agentCallWebhookUrl(req.baseUrl, req.callKey, "gather") }),
        statusCallback: agentCallWebhookUrl(req.baseUrl, req.callKey, "status"),
      });
      const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN!.trim()}`).toString("base64");
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
      if (!res.ok || !json.sid) {
        throw new CallProviderError(`Twilio no hizo la llamada (${res.status}${json.code ? `, código ${json.code}` : ""}): ${json.message ?? "sin detalle"}`);
      }
      return { providerCallId: json.sid, status: json.status ?? "queued" };
    },
  };
};

// ── WhatsApp Calling API (opción A) ─────────────────────────────────────

/** POST /{phone-number-id}/calls — llamada iniciada por la empresa. */
export const whatsAppCallRequest = (input: { phoneNumberId: string; to: string; sdpOffer: string }) => ({
  path: `${input.phoneNumberId}/calls`,
  body: {
    messaging_product: "whatsapp",
    to: input.to.replace(/\D/g, ""),
    action: "connect",
    session: { sdp_type: "offer", sdp: input.sdpOffer },
  },
});

export const whatsAppProvider = (env: Env = process.env, fetchImpl: FetchLike = (i, o) => fetch(i, o)): CallProvider => {
  const missing = () =>
    [
      !env.WHATSAPP_CALLING_PHONE_NUMBER_ID?.trim() && "WHATSAPP_CALLING_PHONE_NUMBER_ID",
      !env.WHATSAPP_CALLING_TOKEN?.trim() && "WHATSAPP_CALLING_TOKEN",
      !env.AGENT_CALL_MEDIA_BRIDGE_URL?.trim() && "AGENT_CALL_MEDIA_BRIDGE_URL",
    ].filter(Boolean) as string[];
  return {
    id: "whatsapp",
    missing,
    place: async (req) => {
      const gaps = missing();
      if (gaps.length) throw new CallNotConfiguredError("WhatsApp", gaps);
      // 1) El puente abre una sesión WebRTC con el modelo de voz y nos da su oferta SDP.
      const bridge = await fetchImpl(`${env.AGENT_CALL_MEDIA_BRIDGE_URL!.replace(/\/$/, "")}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callKey: req.callKey, greeting: req.message }),
      });
      const offer = (await bridge.json().catch(() => ({}))) as { sdp?: string };
      if (!bridge.ok || !offer.sdp) throw new CallProviderError(`El puente de medios no dio una oferta SDP (${bridge.status}).`);
      // 2) Meta llama al teléfono y conecta el audio con esa sesión.
      const { path, body } = whatsAppCallRequest({ phoneNumberId: env.WHATSAPP_CALLING_PHONE_NUMBER_ID!.trim(), to: req.to, sdpOffer: offer.sdp });
      const version = env.META_GRAPH_VERSION?.trim() || "v23.0";
      const res = await fetchImpl(`https://graph.facebook.com/${version}/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.WHATSAPP_CALLING_TOKEN!.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { calls?: { id?: string }[]; error?: { message?: string; code?: number } };
      const id = json.calls?.[0]?.id;
      if (!res.ok || !id) {
        throw new CallProviderError(`WhatsApp no hizo la llamada (${res.status}${json.error?.code ? `, código ${json.error.code}` : ""}): ${json.error?.message ?? "sin detalle"}`);
      }
      return { providerCallId: id, status: "ringing" };
    },
  };
};

export const providerFor = (id: CallProvider["id"], env: Env = process.env, fetchImpl?: FetchLike): CallProvider =>
  id === "fake" ? fakeProvider() : id === "twilio" ? twilioProvider(env, fetchImpl) : whatsAppProvider(env, fetchImpl);
