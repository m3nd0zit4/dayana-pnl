import { describe, expect, test } from "bun:test";

import { conversationSituation, situationText, type SituationMessage } from "./situation";

const inb = (): SituationMessage => ({ direction: "INBOUND" });
const out = (source: string | null = null): SituationMessage => ({ direction: "OUTBOUND", source });

describe("conversationSituation", () => {
  test("primer mensaje: nueva", () => {
    expect(conversationSituation([inb()]).isNew).toBe(true);
  });

  test("varios mensajes seguidos de una vez: sigue siendo nueva", () => {
    expect(conversationSituation([inb(), inb(), inb()]).isNew).toBe(true);
  });

  test("solo recibió la invitación masiva y un «gracias»: nueva", () => {
    const s = conversationSituation([out("bulk:abc"), inb(), out("recordatorio:evt"), inb()]);
    expect(s).toEqual({ isNew: true, priorInbound: 1, priorReplies: 0, autoSends: 2 });
  });

  test("ya le contestaron antes: no es nueva", () => {
    expect(conversationSituation([inb(), out(), inb()]).isNew).toBe(false);
  });

  test("escribió dos veces antes aunque nadie contestara: no es nueva", () => {
    expect(conversationSituation([inb(), out("bulk:x"), inb(), out("bulk:y"), inb()]).isNew).toBe(false);
  });

  test("lo fallido y los avisos grises no cuentan", () => {
    const s = conversationSituation([
      { direction: "OUTBOUND", status: "FAILED" },
      { direction: "INBOUND", kind: "system" },
      inb(),
    ]);
    expect(s.isNew).toBe(true);
  });

  test("el texto le dice a la IA que no la salude como nueva", () => {
    expect(situationText(conversationSituation([inb(), out(), inb()]), false)).toContain("NO es la primera vez");
    expect(situationText(conversationSituation([inb()]), false)).toContain("PERSONA NUEVA");
  });
});
