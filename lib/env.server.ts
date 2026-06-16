import { z } from "zod";
import { assertInngestKeysPaired } from "@/lib/inngest/config";

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
    INNGEST_EVENT_KEY: nonEmpty,
    INNGEST_SIGNING_KEY: nonEmpty,
    UPSTASH_REDIS_REST_URL: nonEmpty,
    UPSTASH_REDIS_REST_TOKEN: nonEmpty,
    NOTIFICATIONS_ENABLED: z.literal("true"),
    NOTIFICATIONS_DRY_RUN: z.literal("false"),
    RESEND_API_KEY: nonEmpty,
    NOTIFICATIONS_EMAIL_FROM: nonEmpty,
    CRM_UI_PREVIEW: z
      .string()
      .optional()
      .refine((v) => v !== "true", "CRM_UI_PREVIEW must not be true in production"),
  })
  .refine(
    (env) => env.NEXT_PUBLIC_PAYPAL_CLIENT_ID === env.PAYPAL_CLIENT_ID,
    "NEXT_PUBLIC_PAYPAL_CLIENT_ID must match PAYPAL_CLIENT_ID"
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
  }

  validated = true;
};
