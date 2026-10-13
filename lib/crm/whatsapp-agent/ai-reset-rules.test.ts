import { describe, expect, test } from "bun:test";

import { SUPERSEDED, normalizePlaybookName, withoutSupersededRefs } from "./ai-reset-rules";

describe("ai-reset-rules", () => {
  test("los básicos que ya dicen las reglas", () => {
    expect(SUPERSEDED.has(normalizePlaybookName(" Agendar "))).toBe(true);
    expect(SUPERSEDED.has(normalizePlaybookName("Precios y pagos"))).toBe(false);
  });

  test("quita la referencia a un procedimiento que se apaga, y nada más", () => {
    const steps =
      "1. Si pregunta el precio: NUNCA des valores. Dayana le explica las opciones en la consulta gratis de 15 minutos; ofrécele agendarla (sigue «Agendar»).\n2. Si insiste: escala con category=payment.";
    expect(withoutSupersededRefs(steps)).toBe(
      "1. Si pregunta el precio: NUNCA des valores. Dayana le explica las opciones en la consulta gratis de 15 minutos; ofrécele agendarla.\n2. Si insiste: escala con category=payment."
    );
    expect(withoutSupersededRefs("Sigue «Precios y pagos» (sigue «Precios y pagos»).")).toBe("Sigue «Precios y pagos» (sigue «Precios y pagos»).");
  });
});
