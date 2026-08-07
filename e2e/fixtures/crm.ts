import { test as base, type Page, type Response } from "@playwright/test";

/**
 * Ruido de consola que no indica nada roto y que no queremos que tumbe el
 * smoke. La lista es de coincidencia por substring exacto a propósito: un
 * comodín acabaría tragándose el error real que estos tests existen para ver.
 */
const IGNORED_CONSOLE = [
  // React DevTools en dev.
  "Download the React DevTools",
  // El panel corre sin sesión en preview; el stream SSE de la campana no se
  // monta y algunas llamadas devuelven 401 a propósito.
  "Failed to load resource: the server responded with a status of 401",
  // Turbopack en dev sirve los sourcemaps aparte.
  "Source map error",
  // El canal HMR del dev server. Chromium bajo Playwright no completa el
  // handshake y reintenta en bucle. Es andamiaje de desarrollo: no existe en
  // producción y no dice nada de la página. Sin esto las 16 rutas fallan por
  // el mismo motivo y el smoke no informa de nada.
  "_next/webpack-hmr",
  "_next/turbopack-hmr",
];

const isIgnored = (text: string) =>
  IGNORED_CONSOLE.some((needle) => text.includes(needle));

export type ConsoleWatcher = {
  /** Errores de consola y excepciones no capturadas, ya filtrados. */
  errors: string[];
};

/**
 * Engancha la recogida de errores ANTES de navegar. Hacerlo después pierde
 * todo lo que ocurre durante la carga, que es justo lo que importa.
 */
export const watchConsole = (page: Page): ConsoleWatcher => {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!isIgnored(text)) errors.push(`console.error: ${text}`);
  });

  page.on("pageerror", (err) => {
    const text = err.message;
    if (!isIgnored(text)) errors.push(`pageerror: ${text}`);
  });

  return { errors };
};

/**
 * Navega a una ruta del CRM y espera a que el shell haya pintado.
 *
 * Espera a `networkidle` no: el panel abre un stream SSE en cuanto hay sesión
 * y eso no termina nunca. Se espera al DOM y al marcador de página.
 */
export const gotoCrm = async (
  page: Page,
  path: string,
): Promise<Response | null> => {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  await page
    .locator("[data-crm-page]")
    .first()
    // Generoso a propósito: incluye la compilación en frío de la ruta.
    .waitFor({ state: "attached", timeout: 60_000 })
    .catch(() => {
      // Todavía no todas las páginas llevan el marcador — durante la
      // migración eso es esperado. El test que lo exige es el del contrato,
      // no este helper.
    });
  return response;
};

type Fixtures = {
  consoleWatcher: ConsoleWatcher;
};

export const test = base.extend<Fixtures>({
  consoleWatcher: async ({ page }, use) => {
    await use(watchConsole(page));
  },
});

export { expect } from "@playwright/test";
