/**
 * Capturas del «Modo voz» del panel en escritorio y teléfono, contra un
 * `next dev` local en neondb_dev. Chrome sin pantalla no tiene micrófono ni
 * voz, así que se reemplazan `SpeechRecognition` y `speechSynthesis` por
 * dobles: lo que «dice» Dayana entra por `window.__say(text)` y lo que el
 * asistente dice en voz alta queda en `window.__spoken`. El agente, las
 * aprobaciones y el panel son los de verdad.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts .eve/owner-storage.json http://localhost:3100
 *   node node_modules/tsx/dist/cli.mjs scripts/dev/voice-mode-shots.ts .eve/owner-storage.json .eve/screenshots/voz
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, type BrowserContextOptions } from "@playwright/test";

type VoiceWindow = Window & {
  __spoken: string[];
  __heardLog: string[];
  __listening?: boolean;
  __say: (text: string) => boolean;
};
declare const window: VoiceWindow;

const [storage, outDir, base = "http://localhost:3100"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const FAKES = () => {
  window.__spoken = [];
  window.__heardLog = [];
  type Handlers = { onresult?: (e: unknown) => void; onend?: () => void };
  let active: (FakeRecognition & Handlers) | null = null;
  class FakeRecognition {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    constructor() {
      this.lang = "es-CO";
      this.continuous = true;
      this.interimResults = true;
    }
    start() {
      // Una sola instancia viva, como en el navegador.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      active = this;
      window.__listening = true;
    }
    stop() {
      if (active === this) active = null;
      window.__listening = false;
      setTimeout(() => (this as Handlers).onend?.(), 30);
    }
    abort() {
      this.stop();
    }
  }
  const results = (text: string, isFinal: boolean) => {
    const result = { isFinal, length: 1, item: () => ({ transcript: text, confidence: 0.9 }), 0: { transcript: text } };
    return { resultIndex: 0, results: { length: 1, item: () => result, 0: result } };
  };
  window.__say = (text: string) => {
    const rec = active;
    if (!rec) return false;
    window.__heardLog.push(text);
    const words = text.split(" ");
    const half = words.slice(0, Math.ceil(words.length / 2)).join(" ");
    rec.onresult?.(results(half, false));
    setTimeout(() => rec.onresult?.(results(text, true)), 300);
    return true;
  };
  Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
  const synth = {
    speaking: false,
    _t: undefined as ReturnType<typeof setTimeout> | undefined,
    getVoices: () => [{ lang: "es-CO", name: "Google español de Colombia (doble de prueba)", localService: false }],
    addEventListener() {},
    removeEventListener() {},
    cancel() {
      this.speaking = false;
      if (this._t) clearTimeout(this._t);
    },
    speak(u: SpeechSynthesisUtterance) {
      if (u.text.trim()) window.__spoken.push(u.text);
      this.speaking = true;
      // ~ 14 caracteres por segundo, acelerado ×4 para la prueba.
      this._t = setTimeout(() => {
        this.speaking = false;
        u.onend?.(new Event("end") as SpeechSynthesisEvent);
      }, Math.max(80, (u.text.length / 14) * 250));
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
};

const run = async (label: string, contextOptions: BrowserContextOptions) => {
  const browser = await chromium.launch({
    channel: "chrome",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const context = await browser.newContext({ ...contextOptions, storageState: storage, permissions: ["microphone"] });
  // tsx/esbuild envuelve las funciones con `__name(...)`, que en la página no existe.
  await context.addInitScript({ content: `var __name = (f) => f; (${FAKES.toString()})();` });
  const page = await context.newPage();
  const shot = async (name: string) => {
    await page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) });
    console.log(`  ${label}-${name}.png`);
  };
  await page.goto(`${base}/admin`, { waitUntil: "networkidle", timeout: 180_000 });
  // El indicador «N» de `next dev` tapa el botón «Cancelar» en el teléfono.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const phone = await page.getByTestId("pill-voice-mode").isVisible().catch(() => false);
  if (phone) {
    // En el teléfono se entra por la pastilla de abajo: con la caja vacía, el botón es «Modo voz».
    await shot("01-pastilla-con-modo-voz");
    await page.getByTestId("pill-voice-mode").click();
  } else {
    await page.getByRole("button", { name: "Asistente CRM" }).first().click();
    await page.getByTestId("voice-mode-toggle").first().waitFor({ timeout: 60_000 });
    await shot("01-composer-con-modo-voz");
    await page.getByTestId("voice-mode-toggle").first().click();
  }
  await page.getByTestId("voice-mode-bar").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__listening === true);
  await shot("02-te-escucho");

  await page.evaluate(() => window.__say("¿Cuántos contactos nuevos tuvimos esta semana?"));
  await page.waitForTimeout(350);
  await shot("03-transcribiendo");
  // Silencio → se manda solo → el agente responde → lo lee en voz alta.
  await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 180_000 });
  await shot("04-hablando");
  await page.waitForFunction(() => window.__listening === true && !window.speechSynthesis.speaking, null, { timeout: 120_000 });
  await shot("05-vuelve-a-escuchar");

  // Una acción en el mismo hilo: la tarjeta de aprobación se lee y un «sí» hablado abre la cuenta atrás.
  await page.evaluate(() => window.__say("Crea el contacto Prueba Voz con el número más 57 300 555 0199"));
  await page.getByTestId("agent-approval-card").waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => window.__spoken.some((t) => t.includes("Necesito tu aprobación")), null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__listening === true, null, { timeout: 60_000 });
  await shot("06-aprobacion-leida");
  await page.evaluate(() => window.__say("sí"));
  await page.getByTestId("voice-approval-countdown").waitFor({ timeout: 10_000 });
  await shot("07-cuenta-atras-si-hablado");
  await page.getByTestId("voice-approval-cancel").click();
  await page.waitForTimeout(500);
  await shot("08-cancelado-sigue-la-tarjeta");
  // Rechazarla de viva voz: nada se crea.
  await page.waitForFunction(() => window.__listening === true, null, { timeout: 60_000 });
  await page.evaluate(() => window.__say("no"));
  await page.waitForFunction(() => window.__spoken.some((t) => t.includes("no lo hago")), null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot("09-rechazado-por-voz");

  console.log(`  ${label} habló:`, JSON.stringify(await page.evaluate(() => window.__spoken), null, 1));
  await page.getByTestId("voice-exit").click();
  await shot("10-salir-del-modo-voz");
  await browser.close();
};

(async () => {
  console.log("escritorio");
  await run("escritorio", { viewport: { width: 1440, height: 900 } });
  console.log("teléfono");
  await run("telefono", { ...devices["Pixel 7"] });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
