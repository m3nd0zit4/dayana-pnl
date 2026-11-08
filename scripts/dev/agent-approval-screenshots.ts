/**
 * The specialist's approval card shows up in the panel (8-nov bug: a second
 * turn delegated a WhatsApp send and the card never appeared), and
 * «Pregúntale al asistente» from a chat waiting for Dayana. Every approval is
 * CANCELLED: nothing is sent. Local `next dev` on neondb_dev + eval server.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts
 *   bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts .eve/owner-storage.json http://localhost:3100
 *   EVE_DIRECT=http://localhost:2100 CHAT_ID=<Valentina's conversation id> node node_modules/tsx/dist/cli.mjs scripts/dev/agent-approval-screenshots.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, devices, type BrowserContext, type Page } from "@playwright/test";

const base = "http://localhost:3100";
const out = ".eve/screenshots/aprobaciones";
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

const open = async (context: BrowserContext, path: string) => {
  const page = await context.newPage();
  await routeEve(page);
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  return page;
};

const send = async (page: Page, text: string) => {
  const box = page.getByTestId("agent-panel").locator("textarea").first();
  await box.fill(text);
  await box.press("Enter");
  await page.getByTestId("agent-message").last().waitFor({ timeout: 120_000 });
};

const waitIdle = (page: Page) =>
  page.waitForFunction(() => !document.querySelector('[data-testid="agent-panel"] textarea:disabled'), undefined, {
    timeout: 180_000,
  });

const denyCard = async (page: Page, shot: string) => {
  const card = page.getByTestId("agent-approval-card");
  await card.waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);
  console.log(`card: ${(await card.innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
  await page.screenshot({ path: `${out}/${shot}` });
  await page.getByTestId("agent-approval-deny").click();
  await waitIdle(page);
  await page.waitForTimeout(2500);
};

void (async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const storageState = ".eve/owner-storage.json";
  try {
    // 1) Desktop: second turn delegates a WhatsApp send → the card appears.
    const desktop = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
    const d = await open(desktop, "/admin");
    await d.getByRole("button", { name: "Asistente CRM" }).first().click();
    await d.getByTestId("agent-panel").waitFor();
    await send(d, "¿Qué tengo pendiente hoy?");
    await waitIdle(d);
    await send(d, "Escríbele por WhatsApp a Valentina Prueba Eval para proponerle mover su llamada gratis al jueves a las 3:00 p. m.");
    await denyCard(d, "01-desktop-segundo-turno-tarjeta.png");
    await d.screenshot({ path: `${out}/02-desktop-cancelado.png` });

    // 2) Phone: from the chat waiting for Dayana, «Pregúntale al asistente».
    const chatId = process.env.CHAT_ID;
    if (chatId) {
      const phone = await browser.newContext({ ...devices["Pixel 7"], storageState, hasTouch: true });
      const p = await open(phone, `/admin/whatsapp?conversation=${chatId}`);
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `${out}/03-phone-chat-te-toca.png` });
      await p.getByRole("button", { name: "Asistente", exact: true }).first().click();
      await p.getByTestId("agent-opener").waitFor({ timeout: 30_000 });
      await p.waitForTimeout(1000);
      await p.screenshot({ path: `${out}/04-phone-opener.png` });
      await send(p, "Dile que sí, que el jueves a las 3:00 p. m. Dayana la llama por WhatsApp.");
      await denyCard(p, "05-phone-tarjeta.png");
      await p.screenshot({ path: `${out}/06-phone-cancelado.png` });
    }
  } catch (e) {
    console.error(String(e).slice(0, 600));
  } finally {
    await browser.close();
    console.log(`screenshots → ${out}`);
  }
})();
