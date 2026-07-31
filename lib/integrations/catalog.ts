import type { IntegrationHealthId } from "@/lib/notifications/health";

/**
 * Fuente única de verdad del catálogo de integraciones/conexiones.
 *
 * Mismo espíritu que `lib/notifications/platform/catalog.ts`: un `Record`
 * exhaustivo, puro (sin Prisma, sin React), que agrupa y describe cada
 * conexión externa para que la pantalla de Ajustes > Integraciones no tenga
 * que decidir por su cuenta cómo se llama, en qué grupo va, o qué modelo de
 * autenticación usa. Los canales del agente (por dónde se le puede hablar,
 * no a qué llama) no viven aquí — ver `lib/crm/agent-channels.ts`.
 *
 * Al agregar una integración: si es solo variables de entorno, añade su
 * entrada a `getIntegrationHealth()` (`lib/notifications/health.ts`) primero
 * — de ahí sale el `IntegrationHealthId` que este catálogo exige — y luego
 * agrégala aquí. El `Record` es exhaustivo, así que TypeScript falla si se te
 * olvida.
 */

export const INTEGRATION_GROUPS = [
  "Pagos",
  "Redes sociales",
  "Google",
  "Sistema",
] as const;

export type IntegrationGroup = (typeof INTEGRATION_GROUPS)[number];

/** Ancla de sección dentro de `/admin/ajustes/integraciones`. */
export const GROUP_ANCHOR: Record<IntegrationGroup, string> = {
  Pagos: "pagos",
  "Redes sociales": "redes-sociales",
  Google: "google",
  Sistema: "sistema",
};

export type IntegrationAuthModel =
  /** Solo variables de entorno; sin cuenta que conectar o revocar desde la UI. */
  | "static-env"
  /** OAuth propio, token cifrado en nuestra base (`SocialAccount`). */
  | "custom-oauth"
  /** Vercel Connect guarda el token; nosotros solo la metadata (`GoogleAccount`). */
  | "vercel-connect";

export type IntegrationCatalogEntry = {
  label: string;
  group: IntegrationGroup;
  authModel: IntegrationAuthModel;
  /**
   * `true` cuando el valor de entorno tiene una capa de override en base de
   * datos por encima (ver `lib/notifications/*` y `lib/agent/*`/`lib/tiktok/*`
   * para dónde se resuelve cada una). Puramente informativo por ahora — nada
   * lee este campo todavía — para cuando la UI necesite distinguir "solo
   * entorno" de "entorno con override" sin repetir la lista a mano.
   */
  overridable?: boolean;
};

/** Meta y TikTok no tienen `IntegrationHealth` propio — su estado sale de `SocialAccount`. */
export type IntegrationId = IntegrationHealthId | "meta" | "tiktok";

export const INTEGRATION_CATALOG: Record<IntegrationId, IntegrationCatalogEntry> = {
  meta: {
    label: "Meta — WhatsApp, Facebook e Instagram",
    group: "Redes sociales",
    authModel: "custom-oauth",
    overridable: true,
  },
  tiktok: {
    label: "TikTok",
    group: "Redes sociales",
    authModel: "custom-oauth",
    // SOCIAL_PUBLISHING_ENABLED/TIKTOK_AUDITED tienen override en base de datos.
    overridable: true,
  },
  google: {
    label: "Google",
    group: "Google",
    authModel: "vercel-connect",
  },
  paypal: {
    label: "PayPal",
    group: "Pagos",
    authModel: "static-env",
  },
  mercadopago: {
    label: "Mercado Pago",
    group: "Pagos",
    authModel: "static-env",
  },
  email: {
    label: "Correo",
    group: "Sistema",
    authModel: "static-env",
    overridable: true,
  },
  sms: {
    label: "SMS",
    group: "Sistema",
    authModel: "static-env",
    overridable: true,
  },
  whatsapp: {
    label: "WhatsApp API",
    group: "Sistema",
    authModel: "static-env",
    overridable: true,
  },
  inngest: {
    label: "Tareas en segundo plano",
    group: "Sistema",
    authModel: "static-env",
  },
  redis: {
    label: "Límite de peticiones",
    group: "Sistema",
    authModel: "static-env",
  },
  database: {
    label: "Base de datos",
    group: "Sistema",
    authModel: "static-env",
  },
  agent: {
    label: "Asistente IA",
    group: "Sistema",
    authModel: "static-env",
    overridable: true,
  },
};
