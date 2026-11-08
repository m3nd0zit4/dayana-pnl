/**
 * 8-nov bug: after approving a specialist's card, the step kept spinning
 * («Ejecutando…») although the specialist had finished and the assistant had
 * answered. Approves ONE harmless action on neondb_dev (mark the fixture chat
 * «Valentina Prueba Eval» as favourite: no message is sent) and checks that no
 * step is left running. Refuses to approve anything that is not
 * `whatsapp_set_chat`.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-fixtures.ts
 *   bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts .eve/owner-storage.json http://localhost:3100
 *   EVE_DIRECT=http://localhost:2100 node node_modules/tsx/dist/cli.mjs scripts/dev/agent-specialist-approve.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, devices, type Page } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const out = ".eve/screenshots/especialista";
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

void (async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const phone = await browser.newContext({ ...devices["Pixel 7"], storageState: ".eve/owner-storage.json", hasTouch: true });
    const page = await phone.newPage();
    await routeEve(page);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.locator("[data-slot='sidebar-wrapper']").waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);

    // The ask pill opens the panel with the message (router agent).
    const pill = page.getByRole("textbox", { name: /Pregúntale a/ }).first();
    await pill.fill("Marca como favorito el chat de WhatsApp de Valentina Prueba Eval");
    await pill.press("Enter");
    await page.getByTestId("agent-panel").waitFor({ timeout: 30_000 });

    const card = page.getByTestId("agent-approval-card");
    await card.waitFor({ timeout: 180_000 });
    await page.waitForTimeout(1200);
    const text = (await card.innerText()).replace(/\s+/g, " ");
    console.log(`card: ${text.slice(0, 240)}`);
    await page.screenshot({ path: `${out}/01-tarjeta.png` });
    if (!/Favorito/.test(text) || /WhatsApp a|Enviar/.test(text)) {
      console.log("not the harmless whatsapp_set_chat card: cancelling instead");
      await page.getByTestId("agent-approval-deny").click();
    } else {
      await page.getByTestId("agent-approval-approve").click();
    }

    // The specialist finishes and the assistant answers: nothing may keep spinning.
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="agent-panel"] textarea:disabled'),
      undefined,
      { timeout: 180_000 }
    );
    await page.waitForTimeout(6000);
    const running = await page.locator('[data-testid="agent-activity"][data-state="running"]').count();
    const runningSteps = await page.locator('[data-testid="agent-activity-step"][data-status="running"]').count();
    console.log(`after the answer: running activity=${running}, running steps=${runningSteps}`);
    await page.screenshot({ path: `${out}/02-despues.png` });
  } catch (e) {
    console.error(String(e).slice(0, 600));
  } finally {
    await browser.close();
    console.log(`screenshots → ${out}`);
  }
})();
