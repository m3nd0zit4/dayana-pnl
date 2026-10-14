import { describe, expect, test } from "bun:test";

import { getTimeHmInTz, getTimeLabelInTz } from "./zoned-time";

describe("horas en los mensajes", () => {
  const sixFortyFivePm = new Date("2026-10-15T23:45:00Z"); // 6:45 p. m. en Bogotá

  test("con a. m./p. m., nunca 18:45", () => {
    expect(getTimeLabelInTz(sixFortyFivePm, "America/Bogota")).toBe("6:45 p. m.");
    expect(getTimeLabelInTz(new Date("2026-10-16T14:15:00Z"), "America/Bogota")).toBe("9:15 a. m.");
  });

  test("la de los cálculos sigue en 24 h", () => {
    expect(getTimeHmInTz(sixFortyFivePm, "America/Bogota")).toBe("18:45");
  });
});
