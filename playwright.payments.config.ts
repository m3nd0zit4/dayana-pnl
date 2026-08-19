import { defineConfig, devices } from "@playwright/test";

/**
 * Harness E2E de PAGOS. Separado de `playwright.config.ts` a propósito.
 *
 * El harness del CRM fuerza `CRM_UI_PREVIEW=true` y `DATABASE_URL: ""` para
 * correr contra datos mock sin base de datos. Eso es exactamente lo que aquí
 * NO sirve: un pago se demuestra en las filas de `Payment` y `Enrollment`, así
 * que este servidor hereda el `.env` real (Neon + credenciales de proveedor).
 *
 * Puerto 3200 para no chocar con el `bun dev` de trabajo en 3000.
 *
 * `PAYPAL_WEBHOOK_ID: ""` activa a propósito el bypass de firma de
 * `lib/webhooks/verify.ts` (sólo con NODE_ENV=development). Sin eso no se puede
 * ejercitar el handler del webhook de PayPal en local: `verifyPayPalWebhook`
 * delega en la API de PayPal, que jamás validará una firma fabricada aquí. La
 * verificación de firma de PayPal es, por tanto, lo único que este suite NO
 * cubre — la de Mercado Pago sí, porque es HMAC local y tenemos el secreto.
 */
const PORT = 3200;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e/pagos",
  // Las pruebas de estados de Mercado Pago importan `lib/crm/*` directamente
  // (el estado del pago se lee de la API de MP, no del cuerpo del webhook, así
  // que no se puede provocar por HTTP). Esas libs usan el alias `@/`, y sin
  // esto Playwright no lo resuelve.
  tsconfig: "./tsconfig.e2e.json",
  fullyParallel: false, // comparten base de datos: el orden importa
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "pagos",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `bunx next dev --port ${PORT}`,
    url: `${BASE_URL}/servicios`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "development",
      PAYPAL_WEBHOOK_ID: "",
    },
  },
});
