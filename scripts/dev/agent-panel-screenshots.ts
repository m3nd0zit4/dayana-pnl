/**
 * Screenshots of the panel assistant's states on a local `next dev`.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts .eve/owner-storage.json http://localhost:3100
 *   node node_modules/tsx/dist/cli.mjs scripts/dev/agent-panel-screenshots.ts [baseUrl] [outDir]
 *
 * Light and dark, desktop and mobile. Never approves anything that sends:
 * the only approval it accepts is creating a test contact.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? ".eve/screenshots";
mkdirSync(out, { recursive: true });

const shot = (page: Page, name: string) => page.screenshot({ path: `${out}/${name}.png` });

async function openPanel(page: Page) {
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
  const cookies = page.getByRole("button", { name: /solo necesarias/i });
  if (await cookies.isVisible().catch(() => false)) await cookies.click();
  if (!(await page.getByTestId("agent-panel").isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Asistente CRM" }).first().click();
  }
  await page.getByTestId("agent-panel").waitFor();
  await page.waitForTimeout(800);
}

async function send(page: Page, text: string) {
  const box = page.getByTestId("agent-panel").locator("textarea").first();
  await box.fill(text);
  await box.press("Enter");
}

async function run(theme: "light" | "dark", mobile: boolean) {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    storageState: ".eve/owner-storage.json",
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    colorScheme: theme,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  // `EVE_DIRECT=http://localhost:2100`: send the panel's eve calls straight to
  // an `eve dev` when the Next rewrite isn't there (same host, so the session
  // cookie still goes along).
  const direct = process.env.EVE_DIRECT;
  if (direct) {
    // Chrome drops the cookie on a re-targeted request, so this path logs in
    // with the eval server's bearer token (`scripts/agent/eval-server.ts`).
    const { token } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string };
    await page.route("**/eve/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const headers = { ...(await route.request().allHeaders()), authorization: `Bearer ${token}` };
      return route.continue({ url: `${direct}${url.pathname}${url.search}`, headers });
    });
  }
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("crm-agent-threads");
    } catch {}
  });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);
  const tag = `${mobile ? "mobile" : "desktop"}-${theme}`;

  if (mobile) {
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    await shot(page, `${tag}-01-dashboard`);
    const pill = page.getByPlaceholder("Pregunta").first();
    if (await pill.isVisible().catch(() => false)) {
      await pill.fill("¿Cuánto vendimos en los últimos 30 días?");
      await pill.press("Enter");
      await page.getByTestId("agent-display-blocks").first().waitFor({ timeout: 90_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await shot(page, `${tag}-02-stats`);
    }
    await browser.close();
    return;
  }

  await openPanel(page);
  await shot(page, `${tag}-01-empty`);

  await page.getByTestId("agent-picker-trigger").click();
  await page.getByTestId("agent-picker-menu").waitFor();
  await page.waitForTimeout(400);
  await shot(page, `${tag}-02-picker`);
  await page.keyboard.press("Escape");

  await send(page, "¿Cuánto vendimos en los últimos 30 días?");
  await page.getByTestId("agent-activity").first().waitFor({ timeout: 90_000 });
  await shot(page, `${tag}-03-running`);
  await page.getByTestId("agent-display-blocks").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await shot(page, `${tag}-04-stats`);
  await page.getByTestId("agent-activity").first().click();
  await page.waitForTimeout(400);
  await shot(page, `${tag}-05-steps-open`);

  // Switching agent starts a new thread with that specialist.
  await page.getByTestId("agent-picker-trigger").click();
  await page.getByTestId("agent-picker-option-contactos").click();
  await page.waitForTimeout(800);
  await shot(page, `${tag}-05b-contactos-empty`);
  await send(page, "Crea el contacto Ana Prueba Pantalla con el teléfono +57 300 555 0102");
  await page.getByTestId("agent-approval-card").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(500);
  await shot(page, `${tag}-06-approval`);
  if (theme === "light") {
    await page.getByTestId("agent-approval-approve").click();
    await page.getByTestId("agent-approval-receipt").first().waitFor({ timeout: 90_000 });
  } else {
    await page.getByTestId("agent-approval-deny").click();
    await page.getByTestId("agent-approval-receipt").first().waitFor({ timeout: 90_000 });
  }
  await page.waitForTimeout(2500);
  await shot(page, `${tag}-07-approval-answered`);

  await page.getByTestId("agent-threads-trigger").click();
  await page.getByTestId("agent-threads-menu").waitFor();
  await page.waitForTimeout(400);
  await shot(page, `${tag}-08-threads`);
  await page.keyboard.press("Escape");

  await page.goto(`${base}/admin/ajustes/mcp`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await shot(page, `${tag}-09-mcp-settings`);
  await browser.close();
}

// Under Node (`node node_modules/tsx/dist/cli.mjs …`): Playwright's Chrome
// launch hangs under Bun on Windows. Hence no top-level await.
void (async () => {
  for (const [theme, mobile] of [
    ["light", false],
    ["dark", false],
    ["light", true],
  ] as const) {
    await run(theme, mobile).catch((e) => console.error(`${theme}/${mobile ? "mobile" : "desktop"}:`, String(e).slice(0, 400)));
  }
  console.log(`screenshots → ${out}`);
})();
