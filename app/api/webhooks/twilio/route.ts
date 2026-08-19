import { type NextRequest } from "next/server";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { fireAuditLog } from "@/lib/crm/audit";
import { applyInboundSmsKeyword } from "@/lib/notifications/inbound-sms";
import {
  resolveDryRun,
  resolveNotificationsEnabled,
} from "@/lib/notifications/platform/resolve";
import {
  classifySmsKeyword,
  SMS_AUTO_REPLY,
} from "@/lib/notifications/sms-keywords";
import { verifyTwilioWebhook } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SMS entrante de Twilio — bajas (STOP/BAJA), altas y ayuda.
 *
 * Por qué existe: para destinos +57 Twilio NO mantiene lista de bajas del
 * operador ni procesa palabras clave. Sin esta ruta, quien responde BAJA sigue
 * recibiendo mensajes facturados indefinidamente, porque nada apaga notifySms.
 * En EE. UU. Twilio sí bloquea el número por su cuenta, pero entonces cada
 * envío posterior falla con 21610 y llena la campana de avisos.
 *
 * Todo responde 200 salvo la firma inválida: un no-2xx hace que Twilio
 * reintente y alarme. El 401 es deliberado, es lo que aparece en el Debugger de
 * Twilio cuando la URL está mal configurada.
 */

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const twiml = (body: string) =>
  new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });

const messageTwiml = (text: string) =>
  twiml(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${text}</Message></Response>`
  );

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifyTwilioWebhook(req, rawBody)) {
    fireAuditLog({
      action: "WEBHOOK_REJECTED",
      entityType: "Contact",
      entityId: "twilio-inbound",
      changes: { reason: "invalid_signature" },
    });
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const from = params.get("From")?.trim() ?? "";
  const body = params.get("Body");
  const keyword = classifySmsKeyword(body);

  if (!from || !keyword) return twiml(EMPTY_TWIML);

  // La escritura se aplica siempre, aunque la respuesta no salga.
  await applyInboundSmsKeyword({
    fromE164: from,
    keyword,
    messageSid: params.get("MessageSid"),
    toE164: params.get("To"),
  });

  // Twilio pone OptOutType cuando él mismo gestionó la palabra clave (números
  // de EE. UU./Canadá, toll-free, short codes): ya respondió con su texto
  // estándar y ya actualizó su propia lista. Responder otra vez sería un
  // segundo SMS — y tras un STOP, además, lo rechazaría con 21610.
  //
  // Asimetría a tener presente: la lista de Twilio es por número remitente y
  // notifySms es una sola bandera. Un STOP al número de marketing apaga todo de
  // nuestro lado (sobre-suprimir es el lado seguro), pero un ALTA en un número
  // no desbloquea el otro en Twilio.
  if (params.get("OptOutType")) return twiml(EMPTY_TWIML);

  // La respuesta TwiML la emite Twilio, no este proceso, así que resolveDryRun
  // no puede suprimirla después: hay que no pedirla. Modo simulado significa
  // que no sale nada del servidor.
  const [dryRun, enabled] = await Promise.all([
    resolveDryRun(),
    resolveNotificationsEnabled(),
  ]);
  if (dryRun || !enabled) return twiml(EMPTY_TWIML);

  // Se limita la RESPUESTA, no la escritura: cada TwiML es un segmento
  // facturado y alguien escribiendo AYUDA en bucle sale caro.
  const { ok } = await rateLimitDistributed(`sms-reply:${from}`, 3, 3_600_000);
  if (!ok) return twiml(EMPTY_TWIML);

  return messageTwiml(SMS_AUTO_REPLY[keyword]);
}
