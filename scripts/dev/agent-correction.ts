/**
 * 8-nov bug: typing a correction while a WhatsApp send waited for approval got
 * no answer (eve held the text). Now the panel cancels the card with the
 * message. Checks that a NEW card comes back; every card is CANCELLED.
 *
 *   BASE_URL=http://localhost:3300 EVE_DIRECT=http://localhost:2100 node node_modules/tsx/dist/cli.mjs scripts/dev/agent-correction.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, devices, type Page } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const out = ".eve/screenshots/correccion";
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

const cardText = async (page: Page) =>
  (await page.getByTestId("agent-approval-card").innerText()).replace(/\s+/g, " ").slice(0, 260);

void (async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const ctx = await browser.newContext({ ...devices["Pixel 7"], storageState: ".eve/owner-storage.json", hasTouch: true });
    const page = await ctx.newPage();
    await routeEve(page);
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/eve/v1/")) console.log(`POST ${new URL(req.url()).pathname} ${(req.postData() ?? "").slice(0, 300)}`);
    });
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);

    const pill = page.getByRole("textbox", { name: /Pregúntale a/ }).first();
    await pill.fill("Escríbele por WhatsApp a Valentina Prueba Eval que Dayana puede llamarla hoy a las 4:15 p. m. de Colombia.");
    await pill.press("Enter");
    await page.getByTestId("agent-panel").waitFor({ timeout: 30_000 });
    await page.getByTestId("agent-approval-card").waitFor({ timeout: 180_000 });
    await page.waitForTimeout(1200);
    const first = await cardText(page);
    console.log(`card 1: ${first}`);
    await page.screenshot({ path: `${out}/01-tarjeta.png` });

    // Write the correction instead of pressing a button.
    const box = page.getByTestId("agent-panel").locator("textarea").first();
    await box.fill("Está bien, pero no la vuelvas a saludar, ya la saludamos. Lee el chat y respóndele con ese contexto.");
    await box.press("Enter");
    await page.waitForFunction(
      (prev) => {
        const card = document.querySelector('[data-testid="agent-approval-card"]');
        return card && card.textContent?.replace(/\s+/g, " ").slice(0, 260) !== prev;
      },
      first,
      { timeout: 180_000 }
    );
    await page.waitForTimeout(1500);
    console.log(`card 2: ${await cardText(page)}`);
    await page.screenshot({ path: `${out}/02-nueva-tarjeta.png` });
    await page.getByTestId("agent-approval-deny").click();
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${out}/03-cancelado.png` });
  } catch (e) {
    console.error(String(e).slice(0, 600));
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: `${out}/99-fallo.png` }).catch(() => {});
  } finally {
    await browser.close();
    console.log(`screenshots → ${out}`);
  }
})();
