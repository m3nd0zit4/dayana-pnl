import { describe, expect, test } from "bun:test";

import { quickIntentFor, type QuickLine } from "./quick-intents";

const LINK = "https://chat.whatsapp.com/TEST";
const now = new Date("2026-11-21T20:00:00Z");
const at = (min: number) => new Date(now.getTime() - min * 60_000);
const inb = (body: string, min: number): QuickLine => ({ direction: "INBOUND", body, sentAt: at(min) });
const out = (body: string, min: number): QuickLine => ({ direction: "OUTBOUND", body, sentAt: at(min) });
const run = (recent: QuickLine[], community: string | null = LINK) => quickIntentFor({ recent, triggerMessageId: "w", community, now });

describe("quickIntentFor: entrar a la comunidad (dueña, 21-nov)", () => {
  test("Naty, después de su llamada: el enlace, sin importar el resto", () => {
    const i = run([out("Dayana te llama en 5 minutos", 600), inb("Me podrían agregar ala comunidad por favor.", 1)]);
    expect(i).toEqual({ kind: "community", reply: "Claro, aquí puedes unirte a la comunidad de Dayana", link: LINK, rest: null });
  });

  test("Leidy pidió también los costos: el enlace y Dayana ve lo demás", () => {
    const i = run([inb("Buenas tardes por favor me puedes unir al grupo y enviarme todos los costos 🙏 es que no recuerdo bien", 1)]);
    expect(i?.link).toBe(LINK);
    expect(i?.rest).toContain("costos");
  });

  test("ya se lo mandaron hace poco, o alguien ya contestó: nada", () => {
    expect(run([out(`Aquí está ${LINK}`, 5), inb("Agrégame a la comunidad", 1)])).toBeNull();
    expect(run([inb("Agrégame a la comunidad", 3), out("Claro, ya te agrego", 1)])).toBeNull();
  });

  test("un enlace viejo no impide mandarlo otra vez", () => {
    expect(run([out(`Aquí está ${LINK}`, 600), inb("No me deja entrar a la comunidad", 1)])?.link).toBe(LINK);
  });

  test("sin comunidad configurada o sin pedido: nada", () => {
    expect(run([inb("Agrégame a la comunidad", 1)], null)).toBeNull();
    expect(run([inb("¿Cuánto cuesta la terapia?", 1)])).toBeNull();
    expect(run([inb("Ya pagué el curso, ¿me agregan al grupo?", 1)])).toBeNull();
  });
});
