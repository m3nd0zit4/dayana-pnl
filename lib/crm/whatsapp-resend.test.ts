import { describe, expect, test } from "bun:test";

import { resendTemplateKeys } from "./whatsapp-resend";

describe("resendTemplateKeys", () => {
  test("la autoevaluación sale con su plantilla (y si no está, con «retomar»)", () => {
    expect(resendTemplateKeys("autoevaluacion")).toEqual(["autoevaluacion_bienvenida", "retomar_conversacion"]);
  });

  test("lo demás, con «retomar la conversación» (nunca con la de autoevaluación)", () => {
    expect(resendTemplateKeys(null)).toEqual(["retomar_conversacion"]);
    expect(resendTemplateKeys("crm:perfil")).toEqual(["retomar_conversacion"]);
  });

  test("los avisos automáticos de eventos, talleres y recordatorios no se envuelven en otra plantilla", () => {
    expect(resendTemplateKeys("evento:cmvb6nrh80000js08rfwoaq12:confirmacion")).toBeNull();
    expect(resendTemplateKeys("taller:abc:24h")).toBeNull();
    expect(resendTemplateKeys("recordatorio:no-contesto:evt1")).toBeNull();
  });
});
