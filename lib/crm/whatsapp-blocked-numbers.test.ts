import { describe, expect, test } from "bun:test";

process.env.WHATSAPP_IGNORE_SECRET ||= "test-secret-for-blocked-numbers";

const { blockHash, planBlockSync } = await import("./whatsapp-blocked-numbers");

describe("huella de un número bloqueado", () => {
  test("la misma para todas las formas del número", () => {
    expect(blockHash("5215512345678")).toBe(blockHash("525512345678")!);
    expect(blockHash("+57 300 123 4567")).toBe(blockHash("573001234567")!);
    expect(blockHash("573001234567")).not.toBe(blockHash("573001234568")!);
  });
  test("un id de usuario (BSUID) tiene su propia huella", () => {
    const h = blockHash("PE.2290670648352185");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(blockHash("2290670648352185")!);
  });
});

describe("leer la lista de bloqueados de WhatsApp", () => {
  const row = (phoneHash: string, reason: string, api: boolean) => ({
    phoneHash,
    reason,
    apiBlockedAt: api ? new Date("2026-11-08T12:00:00Z") : null,
  });

  test("los nuevos de la lista se ocultan", () => {
    const plan = planBlockSync({ listedHashes: new Set(["a", "b"]), current: [row("a", "app", true)] });
    expect(plan.add).toEqual(["b"]);
    expect(plan.remove).toEqual([]);
  });

  test("el que Dayana desbloqueó vuelve (vino de la app o lo bloqueamos por la API)", () => {
    const plan = planBlockSync({
      listedHashes: new Set([]),
      current: [row("app1", "app", true), row("sex1", "sexual_content", true)],
    });
    expect(plan.remove.sort()).toEqual(["app1", "sex1"]);
  });

  test("un bloqueo que WhatsApp no aceptó (fuera de 24 h) o uno sin API no se suelta porque falte en la lista", () => {
    const plan = planBlockSync({
      listedHashes: new Set([]),
      current: [row("sex2", "sexual_content", false), row("man1", "manual", false)],
    });
    expect(plan.remove).toEqual([]);
  });
});
