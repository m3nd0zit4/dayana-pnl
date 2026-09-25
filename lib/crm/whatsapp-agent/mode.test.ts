import { expect, test } from "bun:test";
import { effectiveAiMode } from "./mode";

test("el modo general manda: ningún chat es más suelto que él", () => {
  expect(effectiveAiMode("AUTO", "COPILOT")).toBe("COPILOT");
  expect(effectiveAiMode("AUTO", "MANUAL")).toBe("MANUAL");
  expect(effectiveAiMode("COPILOT", "MANUAL")).toBe("MANUAL");
});

test("un chat puede ser más estricto que el general", () => {
  expect(effectiveAiMode("MANUAL", "COPILOT")).toBe("MANUAL");
  expect(effectiveAiMode("COPILOT", "AUTO")).toBe("COPILOT");
  expect(effectiveAiMode("AUTO", "AUTO")).toBe("AUTO");
});
