import { describe, expect, test } from "bun:test";

import { decideRoute, strictest } from "./route";
import type { SegmentVerdict } from "./segment";

const modes = { new_lead: "AUTO", returning_lead: "COPILOT", free_call_booked: "COPILOT", after_call: "MANUAL", client: "MANUAL", ignored: "MANUAL" } as const;
const seg = (segment: SegmentVerdict["segment"]): SegmentVerdict => ({ segment, confidence: 1, reason: "", review: false, source: "rules" });

describe("decideRoute", () => {
  test("enrutador apagado: como antes (el más estricto entre chat y general)", () => {
    expect(decideRoute({ routerEnabled: false, generalMode: "AUTO", chatMode: "COPILOT", override: null, segment: null, modes }).mode).toBe("COPILOT");
  });

  test("el COPILOT pegado del chat ya no cuenta: manda el segmento", () => {
    const r = decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "COPILOT", override: null, segment: seg("new_lead"), modes });
    expect(r.mode).toBe("AUTO");
  });

  test("el modo general es el tope", () => {
    expect(decideRoute({ routerEnabled: true, generalMode: "COPILOT", chatMode: "AUTO", override: null, segment: seg("new_lead"), modes }).mode).toBe("COPILOT");
  });

  test("clienta: Dayana la atiende y le toca («customer»)", () => {
    const r = decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "AUTO", override: null, segment: seg("client"), modes });
    expect(r).toMatchObject({ mode: "MANUAL", skip: "customer" });
  });

  test("personal: nadie contesta y no le toca", () => {
    expect(decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "AUTO", override: null, segment: seg("ignored"), modes }).skip).toBe(
      "ignored_segment"
    );
  });

  test("lo que eligió Dayana para el chat gana al segmento (sin pasar el tope)", () => {
    expect(decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "AUTO", override: "MANUAL", segment: seg("new_lead"), modes })).toMatchObject({
      mode: "MANUAL",
      skip: "manual",
    });
    expect(decideRoute({ routerEnabled: true, generalMode: "COPILOT", chatMode: "AUTO", override: "AUTO", segment: seg("client"), modes }).mode).toBe("COPILOT");
  });

  test("ya tuvo la llamada: la IA calla y le toca a Dayana", () => {
    expect(decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "AUTO", override: null, segment: seg("after_call"), modes })).toMatchObject({
      mode: "MANUAL",
      skip: "after_call",
    });
  });

  test("«La IA responde siempre»: contesta sola aunque sea clienta, ya tuvo la llamada, sea personal o el chat esté en Tú", () => {
    for (const segment of ["client", "after_call", "ignored", "new_lead"] as const) {
      expect(
        decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "MANUAL", override: "MANUAL", segment: seg(segment), modes, always: true })
      ).toEqual({ routerEnabled: true, mode: "AUTO", segment, skip: null, always: true });
    }
  });

  test("«La IA responde siempre» también pasa por encima del modo general (Copiloto o Tú)", () => {
    expect(decideRoute({ routerEnabled: true, generalMode: "COPILOT", chatMode: "AUTO", override: null, segment: seg("client"), modes, always: true }).mode).toBe(
      "AUTO"
    );
    expect(decideRoute({ routerEnabled: false, generalMode: "MANUAL", chatMode: "MANUAL", override: null, segment: null, modes, always: true })).toEqual({
      routerEnabled: false,
      mode: "AUTO",
      segment: null,
      skip: null,
      always: true,
    });
  });

  test("apagado («always» falso): todo como siempre", () => {
    expect(decideRoute({ routerEnabled: true, generalMode: "AUTO", chatMode: "AUTO", override: null, segment: seg("client"), modes, always: false })).toMatchObject({
      mode: "MANUAL",
      skip: "customer",
      always: false,
    });
  });

  test("strictest", () => {
    expect(strictest("AUTO", "COPILOT", "AUTO")).toBe("COPILOT");
    expect(strictest("MANUAL", "AUTO")).toBe("MANUAL");
  });
});
