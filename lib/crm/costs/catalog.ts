/**
 * Todo lo que la plataforma paga para funcionar, en un solo sitio.
 *
 * Puro (sin Prisma, sin React): lo leen la pantalla de Costos, la API y las
 * pruebas. Al conectar un servicio nuevo que cobre —otro proveedor de correo,
 * otro modelo de IA— se añade aquí; el `Record` es exhaustivo, así que
 * TypeScript falla si falta su entrada.
 *
 * Dos maneras de saber cuánto cuesta un servicio:
 *
 *  - **Factura**: alguien la registra en la pantalla (suscripción mensual,
 *    anual o un cobro suelto). Es lo que de verdad se pagó.
 *  - **Medido**: la plataforma lo calcula sola con lo que ya guarda. Las
 *    comisiones de PayPal y Mercado Pago son exactas cuando el pago trae la
 *    suya y, si no, se calculan con la tarifa configurada; la IA es una
 *    aproximación con el precio de lista.
 *
 * `combine` dice qué pasa cuando hay las dos cosas para el mismo mes:
 *
 *  - `bill-wins`: la factura manda y lo medido queda solo de referencia. Es el
 *    caso de la IA: lo medido son solo las respuestas de WhatsApp, y la
 *    factura de Google trae todo (fichas, notas de voz, el asistente del
 *    panel). Sumarlas contaría las respuestas dos veces.
 *  - `sum`: se suman. Las comisiones no llegan en ninguna factura aparte, así
 *    que una factura registrada en ese servicio es otro cobro distinto.
 */

export const COST_SERVICE_IDS = [
  "vercel",
  "neon",
  "gemini",
  "whatsapp",
  "paypal",
  "mercadopago",
  "resend",
  "mux",
  "twilio",
  "upstash",
  "inngest",
  "dominio",
  "google",
  "otro",
] as const;

export type CostServiceId = (typeof COST_SERVICE_IDS)[number];

export type CostService = {
  name: string;
  /** Para qué se usa, en una frase que entienda quien no programa. */
  what: string;
  /** Cómo cobra el proveedor. */
  billing: string;
  /** Dónde está la factura (el panel del proveedor). */
  billingUrl?: string;
  /**
   * Lo que la plataforma calcula sola, en el mejor caso. Ausente = solo se
   * sabe por factura. Si cada mes es exacto o aproximado lo dice `store.ts`.
   */
  measured?: "exact" | "estimate";
  combine: "bill-wins" | "sum";
};

export const COST_SERVICES: Record<CostServiceId, CostService> = {
  vercel: {
    name: "Vercel",
    what: "Donde vive la web, el CRM y el portal de miembros. También guarda los archivos (fotos, audios, PDF).",
    billing: "Plan mensual más lo que se pase del uso incluido.",
    billingUrl: "https://vercel.com/dashboard",
    combine: "bill-wins",
  },
  neon: {
    name: "Neon",
    what: "La base de datos: contactos, pagos, chats, cursos.",
    billing: "Por uso: horas de cómputo y gigas guardados.",
    billingUrl: "https://console.neon.tech",
    combine: "bill-wins",
  },
  gemini: {
    name: "Gemini (Google AI)",
    what: "La inteligencia artificial: respuestas de WhatsApp, asistente del panel, notas de voz, clasificación de chats.",
    billing: "Por uso: cada texto que lee y escribe.",
    billingUrl: "https://aistudio.google.com",
    measured: "estimate",
    combine: "bill-wins",
  },
  whatsapp: {
    name: "WhatsApp (360dialog y Meta)",
    what: "La conexión del número de WhatsApp con el CRM y las plantillas que se envían fuera de las 24 horas.",
    billing: "Licencia mensual de 360dialog más lo que Meta cobra por cada plantilla.",
    billingUrl: "https://hub.360dialog.com",
    combine: "bill-wins",
  },
  paypal: {
    name: "PayPal",
    what: "Cobros en dólares. La comisión se descuenta de cada pago.",
    billing: "Comisión por cada pago recibido.",
    billingUrl: "https://www.paypal.com",
    measured: "exact",
    combine: "sum",
  },
  mercadopago: {
    name: "Mercado Pago",
    what: "Cobros en pesos (PSE, Nequi, tarjeta). La comisión se descuenta de cada pago.",
    billing: "Comisión por cada pago recibido.",
    billingUrl: "https://www.mercadopago.com.co",
    measured: "exact",
    combine: "sum",
  },
  resend: {
    name: "Resend",
    what: "Los correos: confirmaciones de pago, recordatorios, accesos al portal.",
    billing: "Plan mensual según cuántos correos salen.",
    billingUrl: "https://resend.com",
    combine: "bill-wins",
  },
  mux: {
    name: "Mux",
    what: "Los videos de los cursos del portal de miembros.",
    billing: "Por uso: minutos guardados y minutos vistos.",
    billingUrl: "https://dashboard.mux.com",
    combine: "bill-wins",
  },
  twilio: {
    name: "Twilio",
    what: "Mensajes de texto (SMS), si se usan.",
    billing: "Por cada SMS enviado.",
    billingUrl: "https://console.twilio.com",
    combine: "bill-wins",
  },
  upstash: {
    name: "Upstash",
    what: "Protección contra abuso: limita cuántas veces se puede intentar entrar o enviar un formulario.",
    billing: "Gratis hasta cierto uso; después, por uso.",
    billingUrl: "https://console.upstash.com",
    combine: "bill-wins",
  },
  inngest: {
    name: "Inngest",
    what: "Las tareas que corren solas: recordatorios, envíos programados, seguimientos.",
    billing: "Gratis hasta cierto uso; después, plan mensual.",
    billingUrl: "https://app.inngest.com",
    combine: "bill-wins",
  },
  dominio: {
    name: "Dominio",
    what: "El nombre dayanabeltran.com.",
    billing: "Renovación anual.",
    combine: "bill-wins",
  },
  google: {
    name: "Google Workspace",
    what: "Correo, calendario y Meet de la cuenta de trabajo, si es un plan de pago.",
    billing: "Plan mensual por cuenta.",
    billingUrl: "https://admin.google.com",
    combine: "bill-wins",
  },
  otro: {
    name: "Otro",
    what: "Cualquier otro gasto de la plataforma que no esté en la lista.",
    billing: "Lo que se registre.",
    combine: "sum",
  },
};

export const isCostServiceId = (value: unknown): value is CostServiceId =>
  typeof value === "string" && (COST_SERVICE_IDS as readonly string[]).includes(value);
