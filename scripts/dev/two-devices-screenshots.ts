/**
 * Same OWNER on two devices at once (desktop + phone) against a local
 * `next dev` on neondb_dev: the assistant chat and the bell must match.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts .eve/owner-storage.json http://localhost:3100
 *   bun --env-file=../dayana-pnl/.env scripts/dev/two-devices-seed.ts        # 3 unread notifications
 *   EVE_DIRECT=http://localhost:2100 node node_modules/tsx/dist/cli.mjs scripts/dev/two-devices-screenshots.ts
 *
 * Steps: desktop asks the assistant → phone opens the same thread from its
 * history → phone adds a turn → desktop, on focus, shows it. Then desktop
 * marks every notification read → phone's bell shows none unread on focus.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, devices, type BrowserContext, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const out = ".eve/screenshots/sync";
mkdirSync(out, { recursive: true });

const routeEve = async (page: Page) => {
  const direct = process.env.EVE_DIRECT;
  if (!direct) return;
  const { token } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string };
  await page.route("**/eve/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = { ...(await route.request().allHeaders()), authorization: `Bearer ${token}` };
    return route.continue({ url: `${direct}${url.pathname}${url.search}`, headers });
  });
};

const open = async (context: BrowserContext, label = "") => {
  const page = await context.newPage();
  await routeEve(page);
  if (process.env.SYNC_DEBUG) {
    page.on("response", (res) => {
      const u = new URL(res.url());
      if (u.pathname.startsWith("/api/admin/agent/threads"))
        console.log(`[${label}] ${new Date().toISOString().slice(11, 19)} ${res.request().method()} ${u.pathname} → ${res.status()}`);
    });
  }
  await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  return page;
};

const openPanel = async (page: Page) => {
  if (!(await page.getByTestId("agent-panel").isVisible().catch(() => false))) {
    const toggle = page.getByRole("button", { name: "Asistente CRM" }).first();
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    else await page.getByPlaceholder("Pregunta").first().click();
  }
  await page.getByTestId("agent-panel").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
};

const send = async (page: Page, text: string) => {
  const box = page.getByTestId("agent-panel").locator("textarea").first();
  await box.fill(text);
  await box.press("Enter");
  // The reply is done when the input is enabled again and an assistant message exists.
  await page.getByTestId("agent-message").last().waitFor({ timeout: 120_000 });
  if (process.env.SYNC_DEBUG) console.log(`reply visible ${new Date().toISOString().slice(11, 19)}`);
  await page.waitForFunction(
    // The input is disabled while the agent works (the stream is still open).
    () => !document.querySelector('[data-testid="agent-panel"] textarea:disabled'),
    undefined,
    { timeout: 120_000 }
  );
  if (process.env.SYNC_DEBUG) console.log(`reply done ${new Date().toISOString().slice(11, 19)}`);
  await page.waitForTimeout(3000);
};

const focus = async (page: Page) => {
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(4000);
};

void (async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const storageState = ".eve/owner-storage.json";
  const desktop = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const phone = await browser.newContext({ ...devices["Pixel 7"], storageState, hasTouch: true });
  try {
    const d = await open(desktop, "desktop");
    await openPanel(d);
    // A question unique to this run, so the phone can't pick an older thread.
    const question = `¿Qué tengo pendiente hoy? (prueba ${new Date().toTimeString().slice(0, 5)})`;
    await send(d, question);
    await d.screenshot({ path: `${out}/01-desktop-asked.png` });

    // On the phone the history lives in «Más» → «Conversaciones del agente».
    const p = await open(phone, "phone");
    await p.getByRole("button", { name: "Más opciones" }).click();
    await p.getByTestId("agent-threads-sidebar-trigger").click();
    await p.getByTestId("agent-threads-sidebar").waitFor();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/02-phone-history.png` });
    await p.getByTestId("agent-threads-sidebar-item").filter({ hasText: question }).first().click();
    await p.getByTestId("agent-panel").waitFor({ timeout: 30_000 });
    await p.getByTestId("agent-message").first().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/03-phone-same-thread.png` });

    await send(p, "¿Y cuántos contactos nuevos llegaron en los últimos 7 días?");
    await p.screenshot({ path: `${out}/04-phone-followup.png` });

    await focus(d);
    await d.getByText("¿Y cuántos contactos nuevos llegaron", { exact: false }).first().waitFor({ timeout: 45_000 });
    await d.waitForTimeout(800);
    await d.screenshot({ path: `${out}/05-desktop-sees-followup.png` });

    // Notifications: read on the desktop → read on the phone.
    await d.keyboard.press("Escape");
    await d.getByRole("button", { name: /^Notificaciones/ }).first().click();
    await d.waitForTimeout(1200);
    await d.screenshot({ path: `${out}/06-desktop-bell-before.png` });
    await d.getByRole("button", { name: "Marcar todo como leído" }).click();
    await d.waitForTimeout(1500);
    await d.screenshot({ path: `${out}/07-desktop-bell-read.png` });

    await focus(p);
    await p.keyboard.press("Escape");
    await p.getByRole("button", { name: /^Notificaciones/ }).first().click();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/08-phone-bell-read.png` });
    const label = await p.getByRole("button", { name: /^Notificaciones/ }).first().getAttribute("aria-label");
    console.log(`phone bell after desktop read-all: ${label}`);
  } catch (e) {
    console.error(String(e).slice(0, 500));
  } finally {
    await browser.close();
    console.log(`screenshots → ${out}`);
  }
})();
