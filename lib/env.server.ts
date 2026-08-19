import { z } from "zod";
import { assertInngestKeysPaired } from "@/lib/inngest/config";
import { E164_PATTERN } from "@/lib/notifications/e164";

const isDev = () => process.env.NODE_ENV === "development";
const isVercelProduction = () => process.env.VERCEL_ENV === "production";
const isVercelPreview = () => process.env.VERCEL_ENV === "preview";

/** Strict production deploy (merge to main → Vercel Production). */
export const shouldValidateProductionEnv = (): boolean =>
  isVercelProduction();

/** Warn-only checks on Preview (payments/webhooks may use test creds). */
export const shouldValidatePreviewEnv = (): boolean => isVercelPreview();

const nonEmpty = z.string().trim().min(1);

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine(
    (u) => u.startsWith("https://") && !/localhost|127\.0\.0\.1/i.test(u),
    "Must be HTTPS and not localhost"
  );

type TwilioCoreEnv = Record<string, string | undefined>;

/** Cuántas de las tres credenciales base de Twilio están puestas (0..3). */
const twilioCoreSet = (env: TwilioCoreEnv): number =>
  [env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER].filter(
    (v) => Boolean(v?.trim())
  ).length;

const isBlankOrE164 = (value: string | undefined): boolean =>
  !value?.trim() || E164_PATTERN.test(value.trim());

const productionSchema = z
  .object({
    AUTH_SECRET: nonEmpty.min(32, "AUTH_SECRET must be at least 32 characters"),
    DATABASE_URL: nonEmpty,
    DIRECT_URL: nonEmpty,
    NEXT_PUBLIC_SITE_URL: httpsUrl,
    PAYPAL_MODE: z.literal("live"),
    PAYPAL_CLIENT_ID: nonEmpty,
    PAYPAL_CLIENT_SECRET: nonEmpty,
    NEXT_PUBLIC_PAYPAL_CLIENT_ID: nonEmpty,
    PAYPAL_WEBHOOK_ID: nonEmpty,
    MERCADOPAGO_ACCESS_TOKEN: nonEmpty.refine(
      (t) => !t.startsWith("TEST-"),
      "Use production Mercado Pago token (not TEST-)"
    ),
    NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY: nonEmpty,
    MERCADOPAGO_WEBHOOK_SECRET: nonEmpty,
    // Stripe es opcional a propósito: la pasarela se enciende con
    // STRIPE_CHECKOUT_ENABLED y un despliegue sin Stripe es legítimo. Lo que se
    // rechaza es la configuración a medias — ver los refine() de abajo.
    // Lemon Squeezy: mismo criterio que Stripe — opcional, pero la
    // configuración a medias se rechaza.
    LEMONSQUEEZY_API_KEY: z.string().trim().optional(),
    LEMONSQUEEZY_STORE_ID: z.string().trim().optional(),
    LEMONSQUEEZY_WEBHOOK_SECRET: z.string().trim().optional(),
    LEMONSQUEEZY_CHECKOUT_ENABLED: z.string().trim().optional(),
    NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_ENABLED: z.string().trim().optional(),
    STRIPE_SECRET_KEY: z.string().trim().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().trim().optional(),
    STRIPE_CHECKOUT_ENABLED: z.string().trim().optional(),
    NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED: z.string().trim().optional(),
    INNGEST_EVENT_KEY: nonEmpty,
    INNGEST_SIGNING_KEY: nonEmpty,
    UPSTASH_REDIS_REST_URL: nonEmpty,
    UPSTASH_REDIS_REST_TOKEN: nonEmpty,
    NOTIFICATIONS_ENABLED: z.literal("true"),
    NOTIFICATIONS_DRY_RUN: z.literal("false"),
    RESEND_API_KEY: nonEmpty,
    NOTIFICATIONS_EMAIL_FROM: nonEmpty,
    MUX_TOKEN_ID: nonEmpty,
    MUX_TOKEN_SECRET: nonEmpty,
    MUX_WEBHOOK_SECRET: nonEmpty,
    MUX_SIGNING_KEY_ID: nonEmpty,
    MUX_SIGNING_KEY_PRIVATE: nonEmpty,
    CRM_UI_PREVIEW: z
      .string()
      .optional()
      .refine((v) => v !== "true", "CRM_UI_PREVIEW must not be true in production"),
    CRM_AGENT_ENABLED: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    // Twilio y WhatsApp son opcionales A PROPÓSITO: el canal se enciende por
    // presencia de credenciales (smsProviderReady / whatsAppApiReady) y un
    // despliegue sin SMS es legítimo. Lo que sí se rechaza es la configuración
    // A MEDIAS, que hoy falla en silencio, mensaje a mensaje, dentro de una
    // campaña. Ver los refine() de abajo.
    TWILIO_ACCOUNT_SID: z.string().trim().optional(),
    TWILIO_AUTH_TOKEN: z.string().trim().optional(),
    TWILIO_FROM_NUMBER: z.string().trim().optional(),
    TWILIO_MARKETING_FROM_NUMBER: z.string().trim().optional(),
    TWILIO_WEBHOOK_BASE_URL: httpsUrl.optional(),
    WHATSAPP_API_TOKEN: z.string().trim().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().trim().optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().trim().optional(),
    // Loopback-based auth bypass for the eve channel — local dev only.
    CRM_AGENT_LOCAL_DEV_AUTH: z
      .string()
      .optional()
      .refine(
        (v) => v !== "true",
        "CRM_AGENT_LOCAL_DEV_AUTH must not be true in production"
      ),
  })
  .refine(
    (env) => env.NEXT_PUBLIC_PAYPAL_CLIENT_ID === env.PAYPAL_CLIENT_ID,
    "NEXT_PUBLIC_PAYPAL_CLIENT_ID must match PAYPAL_CLIENT_ID"
  )
  // Without the key the panel renders for the OWNER and every message fails
  // with a provider error — fail the deploy instead of shipping a dead agent.
  .refine(
    (env) =>
      env.CRM_AGENT_ENABLED !== "true" ||
      (env.GEMINI_API_KEY?.trim().length ?? 0) > 0,
    "CRM_AGENT_ENABLED=true requires a non-empty GEMINI_API_KEY"
  )
  // Todo o nada: con dos de las tres, smsProviderReady() es false y cada SMS
  // se registra SKIPPED sin que nadie se entere.
  .refine((env) => {
    const set = twilioCoreSet(env);
    return set === 0 || set === 3;
  }, "Twilio: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER together, or none")
  .refine(
    (env) => isBlankOrE164(env.TWILIO_FROM_NUMBER),
    "TWILIO_FROM_NUMBER must be E.164 (e.g. +573001234567)"
  )
  .refine(
    (env) => isBlankOrE164(env.TWILIO_MARKETING_FROM_NUMBER),
    "TWILIO_MARKETING_FROM_NUMBER must be E.164 (e.g. +573001234567)"
  )
  // Sin número base el remitente de marketing no tiene a qué caer y cada SMS
  // de campaña lanza.
  .refine(
    (env) =>
      !env.TWILIO_MARKETING_FROM_NUMBER?.trim() ||
      Boolean(env.TWILIO_FROM_NUMBER?.trim()),
    "TWILIO_MARKETING_FROM_NUMBER requires TWILIO_FROM_NUMBER"
  )
  // El error más común es pegar el SID de una API Key (SK…) o de un Messaging
  // Service (MG…): la URL queda con pinta correcta y Twilio responde 404.
  .refine(
    (env) =>
      !env.TWILIO_ACCOUNT_SID?.trim() ||
      /^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID.trim()),
    "TWILIO_ACCOUNT_SID must be an Account SID (AC… + 32 hex chars), not an API Key or Messaging Service SID"
  )
  .refine(
    (env) =>
      Boolean(env.WHATSAPP_API_TOKEN?.trim()) ===
      Boolean(env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
    "WhatsApp: set both WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID, or neither"
  )
  // Con la pasarela encendida y sin clave, cada intento de pago devuelve 503 y
  // el cliente ve un botón muerto.
  .refine(
    (env) =>
      env.STRIPE_CHECKOUT_ENABLED !== "true" ||
      ((env.STRIPE_SECRET_KEY?.trim().length ?? 0) > 0 &&
        (env.STRIPE_WEBHOOK_SECRET?.trim().length ?? 0) > 0),
    "STRIPE_CHECKOUT_ENABLED=true requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET"
  )
  // Misma lógica que el token TEST- de Mercado Pago: una clave de prueba en
  // producción cobra en un sandbox y nadie recibe el dinero.
  .refine(
    (env) => !env.STRIPE_SECRET_KEY?.trim().startsWith("sk_test_"),
    "Use a live Stripe secret key in production (not sk_test_)"
  )
  // El botón se pinta con la pública y el endpoint responde con la privada: si
  // sólo se enciende la del cliente, cada clic termina en 503.
  .refine(
    (env) =>
      env.NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED !== "true" ||
      env.STRIPE_CHECKOUT_ENABLED === "true",
    "NEXT_PUBLIC_STRIPE_CHECKOUT_ENABLED=true requires STRIPE_CHECKOUT_ENABLED=true"
  )
  // Sin las tres, el checkout devuelve 503 o el webhook rechaza todo por falta
  // de secreto — y un pago cobrado que no se registra es lo peor que puede pasar.
  .refine(
    (env) =>
      env.LEMONSQUEEZY_CHECKOUT_ENABLED !== "true" ||
      ((env.LEMONSQUEEZY_API_KEY?.trim().length ?? 0) > 0 &&
        (env.LEMONSQUEEZY_STORE_ID?.trim().length ?? 0) > 0 &&
        (env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim().length ?? 0) > 0),
    "LEMONSQUEEZY_CHECKOUT_ENABLED=true requires LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID and LEMONSQUEEZY_WEBHOOK_SECRET"
  )
  // El botón lo pinta la pública y responde el endpoint con la privada: sólo
  // la del cliente encendida deja cada clic en 503.
  .refine(
    (env) =>
      env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_ENABLED !== "true" ||
      env.LEMONSQUEEZY_CHECKOUT_ENABLED === "true",
    "NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_ENABLED=true requires LEMONSQUEEZY_CHECKOUT_ENABLED=true"
  );

let validated = false;

export const validateServerEnv = (): void => {
  if (validated || isDev()) return;

  if (shouldValidateProductionEnv()) {
    assertInngestKeysPaired();
    const result = productionSchema.safeParse(process.env);
    if (!result.success) {
      const details = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(
        `[env] Production environment validation failed:\n${details}`
      );
    }
    validated = true;
    return;
  }

  if (shouldValidatePreviewEnv()) {
    const eventKey = process.env.INNGEST_EVENT_KEY?.trim();
    const signingKey = process.env.INNGEST_SIGNING_KEY?.trim();
    if (Boolean(eventKey) !== Boolean(signingKey)) {
      console.warn(
        "[env] Inngest: set both INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY, or neither"
      );
    }

    const twilioSet = twilioCoreSet(process.env);
    if (twilioSet !== 0 && twilioSet !== 3) {
      console.warn(
        "[env] Twilio: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER together, or none — SMS is silently skipped otherwise"
      );
    }
  }

  validated = true;
};
