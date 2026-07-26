import { isAgentEnabled } from "@/lib/agent/is-agent-enabled";
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
  | "agent";

export type IntegrationHealthStatus = "ok" | "not_configured" | "degraded";

export type IntegrationHealth = {
  id: IntegrationHealthId;
  label: string;
  status: IntegrationHealthStatus;
  detail: string;
  canTest: boolean;
};

const envSet = (name: string): boolean =>
  Boolean(process.env[name]?.trim());

/**
 * Un canal configurado igual no entrega nada si el envío global está apagado o
 * en simulación. Ambos casos son `degraded`: las llaves están, la salida no.
 */
const outboundStatus = (configured: boolean): IntegrationHealthStatus => {
  if (!configured) return "not_configured";
  if (isDryRun() || !isNotificationsEnabled()) return "degraded";
  return "ok";
};

/** Por qué un canal configurado no está entregando. */
const outboundDetail = (readyDetail: string): string => {
  if (isDryRun()) {
    return "Modo simulado activo (NOTIFICATIONS_DRY_RUN): se registra el envío pero no sale nada.";
  }
  if (!isNotificationsEnabled()) {
    return "Envíos apagados globalmente (NOTIFICATIONS_ENABLED no es \"true\").";
  }
  return readyDetail;
};

export const getIntegrationHealth = (): IntegrationHealth[] => {
  const provider = emailProviderId();
  const emailConfigured = provider !== null;
  const dryRun = isDryRun();

  const redisConfigured =
    envSet("UPSTASH_REDIS_REST_URL") && envSet("UPSTASH_REDIS_REST_TOKEN");

  return [
    {
      id: "email",
      label: "Correo",
      status: outboundStatus(emailConfigured),
      detail: emailConfigured
        ? outboundDetail(`Proveedor activo: ${provider}.`)
        : "Sin proveedor: define RESEND_API_KEY o SMTP_HOST/SMTP_USER/SMTP_PASS.",
      // En modo simulado la prueba sigue siendo útil: confirma el flujo y deja
      // constancia en el registro sin gastar cuota del proveedor.
      canTest: emailConfigured || dryRun,
    },
    {
      id: "sms",
      label: "SMS",
      status: outboundStatus(smsProviderReady()),
      detail: smsProviderReady()
        ? outboundDetail("Twilio configurado.")
        : "Sin configurar: faltan TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_FROM_NUMBER.",
      canTest: false,
    },
    {
      id: "whatsapp",
      label: "WhatsApp API",
      status: outboundStatus(whatsAppApiReady()),
      detail: whatsAppApiReady()
        ? outboundDetail("WhatsApp Cloud API configurada.")
        : "Sin configurar: faltan WHATSAPP_API_TOKEN o WHATSAPP_PHONE_NUMBER_ID.",
      canTest: false,
    },
    {
      id: "inngest",
      label: "Tareas en segundo plano",
      status: isInngestConfigured() ? "ok" : "not_configured",
      detail: isInngestConfigured()
        ? "Inngest configurado: recordatorios, campañas y limpieza automática corren."
        : "Sin configurar: faltan INNGEST_EVENT_KEY e INNGEST_SIGNING_KEY. Los crons no corren.",
      canTest: false,
    },
    {
      id: "redis",
      label: "Límite de peticiones (Redis)",
      status: redisConfigured ? "ok" : "not_configured",
      detail: redisConfigured
        ? "Upstash configurado: el límite de peticiones es distribuido."
        : "Sin Upstash: el límite de peticiones es solo en memoria y no se comparte entre instancias.",
      canTest: false,
    },
    {
      id: "database",
      label: "Base de datos",
      status: envSet("DATABASE_URL") ? "ok" : "not_configured",
      detail: envSet("DATABASE_URL")
        ? "DATABASE_URL definida. (No se verifica la conexión desde esta pantalla.)"
        : "Falta DATABASE_URL.",
      canTest: false,
    },
    {
      id: "agent",
      label: "Asistente IA",
      status: isAgentEnabled() ? "ok" : "not_configured",
      detail: isAgentEnabled()
        ? "Asistente habilitado (CRM_AGENT_ENABLED)."
        : "Apagado: CRM_AGENT_ENABLED no es \"true\".",
      canTest: false,
    },
  ];
};

/** Estado global de envío, para el bloque de solo lectura de la UI. */
export const getNotificationsRuntimeStatus = () => ({
  enabled: isNotificationsEnabled(),
  dryRun: isDryRun(),
  emailProvider: emailProviderId(),
});
