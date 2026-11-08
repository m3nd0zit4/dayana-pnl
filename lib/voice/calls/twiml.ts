/**
 * Las llamadas a Dayana por Twilio, sin servidor de WebSocket (Vercel no los
 * mantiene abiertos): cada turno es un TwiML. El asistente dice su mensaje con
 * <Say>, escucha la respuesta con <Gather input="speech"> y Twilio le manda lo
 * que entendió a nuestro webhook, que contesta con otro TwiML. Puro: se prueba
 * sin red.
 */

export const escapeXml = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string);

/** Voz de Twilio para <Say>. Configurable porque el catálogo de voces de Twilio cambia. */
export const twilioVoice = (env: Record<string, string | undefined> = process.env) => ({
  voice: env.TWILIO_CALL_VOICE?.trim() || "Polly.Mia-Neural",
  language: env.TWILIO_CALL_LANGUAGE?.trim() || "es-MX",
});

const say = (text: string, v: { voice: string; language: string }) =>
  `<Say voice="${escapeXml(v.voice)}" language="${escapeXml(v.language)}">${escapeXml(text)}</Say>`;

/** Primer turno: el mensaje, luego escuchar su respuesta (una vez). */
export const callOpeningTwiml = (input: {
  message: string;
  gatherUrl: string;
  voice?: { voice: string; language: string };
}): string => {
  const v = input.voice ?? twilioVoice();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    say(`Hola Dayana, soy tu asistente del CRM. ${input.message}`, v),
    `<Gather input="speech" language="es-CO" speechTimeout="auto" timeout="7" actionOnEmptyResult="true" action="${escapeXml(input.gatherUrl)}" method="POST">`,
    say("¿Qué quieres que haga? Te escucho.", v),
    "</Gather>",
    "</Response>",
  ].join("");
};

/** Lo que se le dice después de oírla, y cuelga. */
export const callClosingTwiml = (heard: string | null, voice?: { voice: string; language: string }): string => {
  const v = voice ?? twilioVoice();
  const text = heard
    ? "Listo, te lo dejo en el panel del asistente para que lo veas y lo apruebes allí. Hasta luego."
    : "No te escuché. Te dejo el mensaje en el panel del asistente. Hasta luego.";
  return ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>", say(text, v), "<Hangup/>", "</Response>"].join("");
};

/** Cuerpo del POST a `Calls.json` (form-urlencoded). */
export const twilioCallForm = (input: {
  to: string;
  from: string;
  twiml: string;
  statusCallback?: string;
  timeoutSec?: number;
}): URLSearchParams => {
  const form = new URLSearchParams({
    To: input.to,
    From: input.from,
    Twiml: input.twiml,
    Timeout: String(input.timeoutSec ?? 25),
    // Si contesta el buzón de voz no tiene sentido hablarle al contestador.
    MachineDetection: "Enable",
  });
  if (input.statusCallback) {
    form.set("StatusCallback", input.statusCallback);
    form.set("StatusCallbackMethod", "POST");
    for (const e of ["answered", "completed"]) form.append("StatusCallbackEvent", e);
  }
  return form;
};
