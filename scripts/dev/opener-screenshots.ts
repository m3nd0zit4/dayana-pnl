/**
 * Screenshots of an agent-started conversation: the bell, the panel opening on
 * the agent's message, Dayana's reply and the single approval card.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/dev/opener-screenshots.ts <key> [baseUrl]
 *
 * Needs `.eve/owner-storage.json` (scripts/dev/staff-session-cookie.ts) and
 * EVE_DIRECT + `.eve/eval-token` like agent-panel-screenshots.ts. Approves the
 * WhatsApp send only because dev sends are simulated (dry-run).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const key = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3100";
const out = ".eve/screenshots";
mkdirSync(out, { recursive: true });

void (async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ storageState: ".eve/owner-storage.json", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const direct = process.env.EVE_DIRECT;
  if (direct) {
    const { token } = JSON.parse(readFileSync(".eve/eval-token", "utf8")) as { token: string };
    await page.route("**/eve/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const headers = { ...(await route.request().allHeaders()), authorization: `Bearer ${token}` };
      return route.continue({ url: `${direct}${url.pathname}${url.search}`, headers });
    });
  }
  try {
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /notificaciones/i }).first().click().catch(() => undefined);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/opener-01-bell.png` });
    await page.keyboard.press("Escape");

    await page.goto(`${base}/admin?agentMessage=${key}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("agent-opener").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/opener-02-panel.png` });

    const box = page.getByTestId("agent-panel").locator("textarea").first();
    await box.fill("Sí, mándale eso a Valentina por WhatsApp.");
    await box.press("Enter");
    await page.getByTestId("agent-approval-card").waitFor({ timeout: 180_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/opener-03-approval.png` });
    await page.getByTestId("agent-approval-approve").click();
    await page.getByTestId("agent-approval-receipt").first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/opener-04-sent.png` });
  } catch (e) {
    console.error(String(e).slice(0, 400));
    await page.screenshot({ path: `${out}/opener-error.png` });
  }
  await browser.close();
  console.log("done");
})();
