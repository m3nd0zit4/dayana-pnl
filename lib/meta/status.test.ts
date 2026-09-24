import { describe, expect, test } from "bun:test";

import { nextStatus } from "./status";

const permutations = <T,>(xs: T[]): T[][] =>
  xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

describe("un estado solo avanza", () => {
  test("enviado, entregado y leído en cualquier orden terminan en leído", () => {
    for (const order of permutations(["SENT", "DELIVERED", "READ"])) {
      expect(order.reduce(nextStatus, "QUEUED")).toBe("READ");
    }
  });
  test("un fallo cuenta solo si aún no se había entregado", () => {
    expect(["SENT", "FAILED"].reduce(nextStatus, "QUEUED")).toBe("FAILED");
    expect(["DELIVERED", "FAILED"].reduce(nextStatus, "QUEUED")).toBe("DELIVERED");
    expect(["READ", "FAILED", "DELIVERED"].reduce(nextStatus, "QUEUED")).toBe("READ");
  });
  test("nada saca a un mensaje de «fallido» hacia atrás", () => {
    expect(nextStatus("FAILED", "SENT")).toBe("FAILED");
  });
});
