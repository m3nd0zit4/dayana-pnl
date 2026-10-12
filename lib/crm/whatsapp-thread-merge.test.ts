import { describe, expect, test } from "bun:test";

import { planThreadMerges } from "./whatsapp-thread-merge";

const row = (id: string, externalThreadId: string, messages: number, at = "2026-10-01T00:00:00Z") => ({
  id,
  externalThreadId,
  messages,
  lastMessageAt: new Date(at),
});

describe("planThreadMerges", () => {
  test("México 52 y 521: queda el que tiene más mensajes", () => {
    const plans = planThreadMerges([row("a", "525512345678", 3), row("b", "5215512345678", 40)]);
    expect(plans).toEqual([
      { survivorId: "b", survivorThreadId: "5215512345678", merge: [{ id: "a", externalThreadId: "525512345678", messages: 3 }] },
    ]);
  });

  test("a igualdad, queda la forma con la que WhatsApp manda", () => {
    const [plan] = planThreadMerges([row("a", "541123456789", 2), row("b", "5491123456789", 2)]);
    expect(plan.survivorThreadId).toBe("5491123456789");
  });

  test("Brasil con y sin 9 es la misma persona", () => {
    expect(planThreadMerges([row("a", "5511987654321", 5), row("b", "551187654321", 1)])).toHaveLength(1);
  });

  test("números distintos y ids de usuario no se tocan", () => {
    expect(
      planThreadMerges([row("a", "573001112233", 5), row("b", "573001112234", 1), row("c", "PE.2290670648352185", 4)])
    ).toEqual([]);
  });
});
