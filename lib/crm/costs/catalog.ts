/**
 * Todo lo que la plataforma paga para funcionar, en un solo sitio.
 *
 * Puro (sin Prisma, sin React): lo leen la pantalla de Costos, la API y las
 * pruebas. Al conectar un servicio nuevo que cobre —otro proveedor de correo,
 * otro modelo de IA— se añade aquí; el `Record` es exhaustivo, así que
 * TypeScript falla si falta su entrada.
 *
 * **PayPal y Mercado Pago no están, a propósito** (decisión del dueño,
 * 9-nov-2026): su comisión no es un costo de la plataforma. El precio que se
 * le pone a un producto es lo que se quiere recibir neto, y al cobrar se le
 * suma la comisión a la clienta (`lib/pricing/fees.ts`, el «gross-up»).
 *
 * La cifra de cada servicio sale sola, de una de tres maneras (`source`):
 *
 *  - `provider`: se le pregunta al proveedor (`auto/`). Vercel dice lo que
 *    facturó; de Neon y Mux se lee el uso y se le aplica su tarifa publicada.
 *  - `usage`: la plataforma anota su propio uso. La IA: cada respuesta de
 *    Gemini deja sus tokens (`lib/ai/usage.ts`) y se les aplica el precio de
 *    lista.
 *  - `fixed`: un plan de precio fijo que el proveedor no informa por ninguna
 *    API. El precio se escribe una vez en `fixed-plans.ts` y cuenta cada mes.
 *
 * Además queda la tabla `platform_costs` para apuntar a mano algo que ninguna
 * de las tres ve (una compra suelta). `combine` dice qué pasa si un servicio
 * tiene a la vez una cifra automática y algo apuntado:
 *
 *  - `bill-wins`: lo apuntado manda y lo automático queda de referencia. Si
 *    alguien registra la factura real de Google o de Neon, esa es la verdad;
 *    sumarla a lo calculado contaría lo mismo dos veces.
 *  - `sum`: se suman («Otro»: cada cosa apuntada es un gasto distinto).
 */

export const COST_SERVICE_IDS = [
  "vercel",
  "dominio",
  "neon",
  "gemini",
  "whatsapp",
  "resend",
  "mux",
  "upstash",
  "inngest",
  "google",
  "twilio",
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
  /** De dónde saca la plataforma la cifra. `manual`: solo si alguien la apunta. */
  source: "provider" | "usage" | "fixed" | "manual";
  combine: "bill-wins" | "sum";
};

export const COST_SERVICES: Record<CostServiceId, CostService> = {
  vercel: {
    name: "Vercel",
    what: "Donde vive la web, el CRM y el portal de miembros. También guarda los archivos (fotos, audios, PDF).",
    billing: "Plan mensual más lo que se pase del uso incluido.",
    billingUrl: "https://vercel.com/dashboard",
    source: "provider",
    combine: "bill-wins",
  },
  dominio: {
    name: "Dominio",
    what: "El nombre dayanabeltran.com, comprado en Vercel.",
    billing: "Renovación anual, repartida en doce meses.",
    billingUrl: "https://vercel.com/dashboard",
    source: "provider",
    combine: "bill-wins",
  },
  neon: {
    name: "Neon",
    what: "La base de datos: contactos, pagos, chats, cursos.",
    billing: "Por uso: horas de cómputo y gigas guardados.",
    billingUrl: "https://console.neon.tech",
    source: "provider",
    combine: "bill-wins",
  },
  gemini: {
    name: "Gemini (Google AI)",
    what: "La inteligencia artificial: respuestas de WhatsApp, notas de voz, fichas, clasificación de chats, revisión de fotos.",
    billing: "Por uso: cada texto que lee y escribe.",
    billingUrl: "https://aistudio.google.com",
    source: "usage",
    combine: "bill-wins",
  },
  whatsapp: {
    name: "WhatsApp (360dialog)",
    what: "La conexión del número de WhatsApp con el CRM.",
    billing: "Licencia mensual de 360dialog. Las plantillas fuera de las 24 horas las cobra Meta aparte.",
    billingUrl: "https://hub.360dialog.com",
    source: "fixed",
    combine: "bill-wins",
  },
  resend: {
    name: "Resend",
    what: "Los correos: confirmaciones de pago, recordatorios, accesos al portal.",
    billing: "Plan mensual según cuántos correos salen.",
    billingUrl: "https://resend.com",
    source: "fixed",
    combine: "bill-wins",
  },
  mux: {
    name: "Mux",
    what: "Los videos de los cursos del portal de miembros.",
    billing: "Por uso: minutos guardados y minutos vistos.",
    billingUrl: "https://dashboard.mux.com",
    source: "provider",
    combine: "bill-wins",
  },
  upstash: {
    name: "Upstash",
    what: "Protección contra abuso: limita cuántas veces se puede intentar entrar o enviar un formulario.",
    billing: "Gratis hasta cierto uso; después, por uso.",
    billingUrl: "https://console.upstash.com",
    source: "fixed",
    combine: "bill-wins",
  },
  inngest: {
    name: "Inngest",
    what: "Las tareas que corren solas: recordatorios, envíos programados, seguimientos.",
    billing: "Gratis hasta cierto uso; después, plan mensual.",
    billingUrl: "https://app.inngest.com",
    source: "fixed",
    combine: "bill-wins",
  },
  google: {
    name: "Google Workspace",
    what: "Correo, calendario y Meet de la cuenta de trabajo, si es un plan de pago.",
    billing: "Plan mensual por cuenta.",
    billingUrl: "https://admin.google.com",
    source: "fixed",
    combine: "bill-wins",
  },
  twilio: {
    name: "Twilio",
    what: "Mensajes de texto (SMS). Hoy no está conectado.",
    billing: "Por cada SMS enviado.",
    billingUrl: "https://console.twilio.com",
    source: "manual",
    combine: "bill-wins",
  },
  otro: {
    name: "Otro",
    what: "Cualquier otro gasto de la plataforma que no esté en la lista.",
    billing: "Lo que se apunte.",
    source: "manual",
    combine: "sum",
  },
};

export const isCostServiceId = (value: unknown): value is CostServiceId =>
  typeof value === "string" && (COST_SERVICE_IDS as readonly string[]).includes(value);
