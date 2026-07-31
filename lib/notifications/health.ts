import { isAgentEnabled } from "@/lib/agent/is-agent-enabled";
import { GOOGLE_CONNECTOR_ENV, isGoogleEnabled } from "@/lib/google/connect";
import { isInngestConfigured } from "@/lib/inngest/config";
import {
  emailProviderId,
  isDryRun,
  isNotificationsEnabled,
  smsProviderReady,
  whatsAppApiReady,
} from "./config";

/**
 * Estado de las integraciones, derivado **solo de variables de entorno**.
 *
 * Deliberadamente sin red: esto se llama al pintar la página de ajustes, y un
 * ping a Resend/Twilio/Neon en cada carga convertiría una pantalla informativa
 * en cuatro round-trips que además fallan de formas que no sabemos explicar.
 * Aquí solo respondemos "¿están puestas las llaves?" — no "¿responde el
 * proveedor?".
 *
 * El valor real de este panel es `degraded`: NOTIFICATIONS_DRY_RUN viene
 * encendido por defecto fuera de producción (ver `isDryRun`), así que el
 * correo "se envía" sin salir nunca. Sin esta pantalla no hay manera de verlo.
 */

export type IntegrationHealthId =
  | "email"
  | "sms"
  | "whatsapp"
  | "inngest"
  | "redis"
  | "database"
  | "agent"
  | "google"
  | "paypal"
  | "mercadopago";

export type IntegrationHealthStatus = "ok" | "not_configured" | "degraded";

export type IntegrationHealth = {
  id: IntegrationHealthId;
  label: string;
  status: IntegrationHealthStatus;
  detail: string;
  canTest: boolean;
  /**
   * Variables de entorno que hay que definir para que la integración funcione.
   *
   * Vive aquí y no en el componente porque el nombre exacto de la variable es
   * la única instrucción accionable de toda la pantalla: si la UI la escribe a
   * mano, el día que cambie el proveedor la pantalla miente y nadie se entera.
   */
  requiredEnv: string[];
  /** Qué se desbloquea al encenderla, en una línea. */
  enables: string;
};

const envSet = (name: string): boolean =>
  Boolean(process.env[name]?.trim());

/**
 * Valores efectivos que `getIntegrationHealth`/`getNotificationsRuntimeStatus`
 * usan para calcular estado. Por defecto vienen del entorno (`is*()`), pero el
 * llamador (ya async, en la página de ajustes) puede pasar el valor efectivo
 * tras resolver un override en base de datos — sin que este módulo toque
 * Prisma, que es justo la garantía de "zero-I/O" que documenta el comentario
 * de arriba.
 */
export type IntegrationHealthOverrides = {
  notificationsEnabled?: boolean;
  dryRun?: boolean;
  agentEnabled?: boolean;
};

/**
 * Un canal configurado igual no entrega nada si el envío global está apagado o
 * en simulación. Ambos casos son `degraded`: las llaves están, la salida no.
 */
const outboundStatus = (
  configured: boolean,
  dryRun: boolean,
  notificationsEnabled: boolean
): IntegrationHealthStatus => {
  if (!configured) return "not_configured";
  if (dryRun || !notificationsEnabled) return "degraded";
  return "ok";
};

/** Por qué un canal configurado no está entregando. */
const outboundDetail = (
  readyDetail: string,
  dryRun: boolean,
  notificationsEnabled: boolean
): string => {
  if (dryRun) {
    return "Modo simulado activo (NOTIFICATIONS_DRY_RUN): se registra el envío pero no sale nada.";
  }
  if (!notificationsEnabled) {
    return "Envíos apagados globalmente (NOTIFICATIONS_ENABLED no es \"true\").";
  }
  return readyDetail;
};

/**
 * Correo tiene dos caminos válidos. Se muestra el que está en uso; cuando no
 * hay ninguno se recomienda Resend, que es el que documenta el proyecto.
 */
const EMAIL_ENV_RESEND = ["RESEND_API_KEY"];
const EMAIL_ENV_SMTP = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];

export const SMS_REQUIRED_ENV = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
];

const WHATSAPP_REQUIRED_ENV = [
  "WHATSAPP_API_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
];

export const getIntegrationHealth = (
  overrides: IntegrationHealthOverrides = {}
): IntegrationHealth[] => {
  const provider = emailProviderId();
  const emailConfigured = provider !== null;
  const dryRun = overrides.dryRun ?? isDryRun();
  const notificationsEnabled =
    overrides.notificationsEnabled ?? isNotificationsEnabled();
  const agentEnabled = overrides.agentEnabled ?? isAgentEnabled();

  const redisConfigured =
    envSet("UPSTASH_REDIS_REST_URL") && envSet("UPSTASH_REDIS_REST_TOKEN");

  const paypalConfigured =
    envSet("PAYPAL_CLIENT_ID") && envSet("PAYPAL_CLIENT_SECRET");
  const paypalLive = process.env.PAYPAL_MODE?.trim().toLowerCase() === "live";

  const mercadopagoToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  const mercadopagoConfigured = Boolean(mercadopagoToken);
  const mercadopagoIsTest = mercadopagoToken?.startsWith("TEST-") ?? false;

  return [
    {
      id: "email",
      label: "Correo",
      status: outboundStatus(emailConfigured, dryRun, notificationsEnabled),
      detail: emailConfigured
        ? outboundDetail(
            `Proveedor activo: ${provider}.`,
            dryRun,
            notificationsEnabled
          )
        : "Sin proveedor: define RESEND_API_KEY o SMTP_HOST/SMTP_USER/SMTP_PASS.",
      // En modo simulado la prueba sigue siendo útil: confirma el flujo y deja
      // constancia en el registro sin gastar cuota del proveedor.
      canTest: emailConfigured || dryRun,
      requiredEnv: provider === "smtp" ? EMAIL_ENV_SMTP : EMAIL_ENV_RESEND,
      enables:
        "Confirmaciones de pago, recordatorios, campañas y los correos que escribe el asistente.",
    },
    {
      id: "sms",
      label: "SMS",
      status: outboundStatus(smsProviderReady(), dryRun, notificationsEnabled),
      detail: smsProviderReady()
        ? outboundDetail("Twilio configurado.", dryRun, notificationsEnabled)
        : "Sin configurar: faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_FROM_NUMBER.",
      canTest: false,
      requiredEnv: SMS_REQUIRED_ENV,
      enables:
        "Recordatorios de sesión y avisos de pago por mensaje de texto, además del envío de SMS desde el asistente.",
    },
    {
      id: "whatsapp",
      label: "WhatsApp API",
      status: outboundStatus(whatsAppApiReady(), dryRun, notificationsEnabled),
      detail: whatsAppApiReady()
        ? outboundDetail(
            "WhatsApp Cloud API configurada.",
            dryRun,
            notificationsEnabled
          )
        : "Sin configurar: faltan WHATSAPP_API_TOKEN o WHATSAPP_PHONE_NUMBER_ID.",
      canTest: false,
      requiredEnv: WHATSAPP_REQUIRED_ENV,
      enables:
        "Enviar plantillas de WhatsApp desde el CRM sin abrir la app en el teléfono.",
    },
    {
      id: "inngest",
      label: "Tareas en segundo plano",
      status: isInngestConfigured() ? "ok" : "not_configured",
      detail: isInngestConfigured()
        ? "Inngest configurado: recordatorios, campañas y limpieza automática corren."
        : "Sin configurar: faltan INNGEST_EVENT_KEY e INNGEST_SIGNING_KEY. Los crons no corren.",
      canTest: false,
      requiredEnv: ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
      enables:
        "Recordatorios diarios, seguimiento de prospectos, campañas por lotes y limpieza de checkouts abandonados.",
    },
    {
      id: "redis",
      label: "Límite de peticiones (Redis)",
      status: redisConfigured ? "ok" : "not_configured",
      detail: redisConfigured
        ? "Upstash configurado: el límite de peticiones es distribuido."
        : "Sin Upstash: el límite de peticiones es solo en memoria y no se comparte entre instancias.",
      canTest: false,
      requiredEnv: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
      enables:
        "Límite de peticiones compartido entre todas las instancias, no solo dentro de una.",
    },
    {
      id: "database",
      label: "Base de datos",
      status: envSet("DATABASE_URL") ? "ok" : "not_configured",
      detail: envSet("DATABASE_URL")
        ? "DATABASE_URL definida. (No se verifica la conexión desde esta pantalla.)"
        : "Falta DATABASE_URL.",
      canTest: false,
      requiredEnv: ["DATABASE_URL", "DIRECT_URL"],
      enables: "Todo el CRM y el sitio público. Sin ella no arranca nada.",
    },
    {
      id: "agent",
      label: "Asistente IA",
      status: agentEnabled ? "ok" : "not_configured",
      detail: agentEnabled
        ? "Asistente habilitado (CRM_AGENT_ENABLED)."
        : "Apagado: CRM_AGENT_ENABLED no es \"true\".",
      canTest: false,
      requiredEnv: ["CRM_AGENT_ENABLED", "GEMINI_API_KEY"],
      enables:
        "El chat del panel: consultar el CRM, redactar mensajes y ejecutar acciones con tu aprobación.",
    },
    {
      id: "google",
      label: "Cuentas de Google",
      // Igual que el resto de esta pantalla, esto solo dice si el conector
      // está declarado. Cuántas cuentas hay conectadas de verdad se ve en
      // /admin/ajustes/google, que sí consulta la base de datos.
      status: isGoogleEnabled() ? "ok" : "not_configured",
      detail: isGoogleEnabled()
        ? "Conector declarado. Las cuentas se conectan en Ajustes → Google."
        : `Falta ${GOOGLE_CONNECTOR_ENV}. Se define tras crear el conector con \`vercel connect create\`.`,
      canTest: false,
      requiredEnv: [GOOGLE_CONNECTOR_ENV],
      enables:
        "Calendario, Contactos y Drive para el asistente, sobre las cuentas de Google que conectes.",
    },
    {
      id: "paypal",
      label: "PayPal",
      status: paypalConfigured ? "ok" : "not_configured",
      detail: paypalConfigured
        ? `Configurado en modo ${paypalLive ? "producción (live)" : "pruebas (sandbox)"}.`
        : "Sin configurar: faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET.",
      canTest: false,
      requiredEnv: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_MODE"],
      enables: "Pago con tarjeta y PayPal para el público fuera de Colombia.",
    },
    {
      id: "mercadopago",
      label: "Mercado Pago",
      status: mercadopagoConfigured ? "ok" : "not_configured",
      detail: mercadopagoConfigured
        ? mercadopagoIsTest
          ? "Token de prueba (TEST-): no procesa cobros reales."
          : "Token de producción configurado."
        : "Sin configurar: falta MERCADOPAGO_ACCESS_TOKEN.",
      canTest: false,
      requiredEnv: ["MERCADOPAGO_ACCESS_TOKEN"],
      enables: "Pago en pesos colombianos para el público en Colombia.",
    },
  ];
};

/** Estado global de envío, para el bloque de la UI (entorno u override ya resuelto). */
export const getNotificationsRuntimeStatus = (
  overrides: Pick<IntegrationHealthOverrides, "notificationsEnabled" | "dryRun"> = {}
) => ({
  enabled: overrides.notificationsEnabled ?? isNotificationsEnabled(),
  dryRun: overrides.dryRun ?? isDryRun(),
  emailProvider: emailProviderId(),
});
