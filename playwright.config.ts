import { defineConfig, devices } from "@playwright/test";

/**
 * Harness E2E del CRM.
 *
 * La decisión que sostiene todo este archivo: los tests corren contra
 * `CRM_UI_PREVIEW=true`, no contra un login real. El motivo no es comodidad —
 * es que no hay alternativa barata:
 *
 *  - `auth.ts` revalida `token.sessionId` contra una fila `StaffSession` en
 *    cada request, así que ninguna cookie falsificada sobrevive.
 *  - `lib/db.ts` usa el driver WebSocket de Neon, no `pg`, así que un
 *    contenedor `postgres:16` en CI necesitaría un sidecar `wsproxy`.
 *  - `scripts/build.mjs` corre `prisma migrate deploy`, así que ni siquiera se
 *    puede producir un build de producción sin DB.
 *
 * Y a cambio sale gratis un fixture: cada ruta de lista del CRM ya trae una
 * rama `isCrmUiPreview()` con datos mock curados a mano.
 *
 * `DATABASE_URL: ""` es la línea que lo hace funcionar. `isCrmUiPreview()`
 * exige `!process.env.DATABASE_URL?.trim()`, y `@next/env` solo vuelca una
 * clave del `.env` en disco cuando `typeof process.env[key] === "undefined"`
 * — una cadena vacía ya está definida, así que gana. Local y CI se comportan
 * igual aunque en local exista un `.env` con DB real.
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Tier B (login real) solo existe si alguien apunta a una DB de scratch. */
const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: !process.env.CI,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  /**
   * 90 s por test, no los 30 s por defecto.
   *
   * Turbopack compila cada ruta la primera vez que alguien la pide — unos 13 s
   * para `/admin` en frío. Con quince rutas del contrato pidiéndose a la vez,
   * varias esperan detrás de la cola de compilación y superan los 30 s sin que
   * haya nada roto. El síntoma engaña: el test falla en el primer `locator`,
   * como si el marcador no existiera.
   *
   * No es tiempo perdido: solo se agota cuando de verdad hay que esperar.
   */
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "crm-preview",
      testMatch: /crm-(smoke|contract)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Tier B: rutas que necesitan sesión + DB (detalle de contacto, inbox,
    // contenido, ajustes). Se cablea aquí para que exista, pero se omite
    // entero mientras no haya DATABASE_URL — en CI eso es siempre, salvo que
    // se configure el secret de una rama Neon de scratch.
    ...(hasDatabase
      ? [
          {
            name: "crm-auth",
            testMatch: /authed\/.*\.spec\.ts/,
            use: {
              ...devices["Desktop Chrome"],
              storageState: "e2e/.auth/owner.json",
            },
            dependencies: ["crm-auth-setup"],
          },
          {
            name: "crm-auth-setup",
            testMatch: /auth\.setup\.ts/,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],

  webServer: {
    command: `bunx next dev --port ${PORT}`,
    url: `${BASE_URL}/admin`,
    // Turbopack en frío compila el panel entero la primera vez. 180s no es
    // paranoia: en un runner de CI sin caché de `.next` se acerca al minuto.
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "development",
      CRM_UI_PREVIEW: "true",
      // Ver la nota de cabecera. No quitar.
      DATABASE_URL: "",
    },
  },
});
