import { describe, expect, test } from "bun:test";

import { normalizeMetaPayload } from "./inbound";

const wrap = (value: Record<string, unknown>, field = "messages") => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba", changes: [{ field, value: { metadata: { phone_number_id: "pn1" }, ...value } }] }],
});

describe("normalizeMetaPayload (WhatsApp)", () => {
  test("un mensaje sin `from` (nombre de usuario) no se pierde: usa el contacto", () => {
    const events = normalizeMetaPayload(
      wrap({
        contacts: [{ wa_id: "51987654321", profile: { name: "Rosa" } }],
        messages: [{ id: "wamid.1", timestamp: "1790000000", type: "text", text: { body: "Hola" } }],
      })
    );
    expect(events).toHaveLength(1);
    const m = events[0];
    expect(m.kind).toBe("message");
    if (m.kind === "message") {
      expect(m.threadId).toBe("51987654321");
      expect(m.participantName).toBe("Rosa");
      expect(m.body).toBe("Hola");
    }
  });

  test("reacción, ubicación y abrir el chat se vuelven texto", () => {
    const events = normalizeMetaPayload(
      wrap({
        messages: [
          { id: "a", from: "573001", timestamp: "1", type: "reaction", reaction: { emoji: "❤️" } },
          { id: "b", from: "573001", timestamp: "2", type: "location", location: { latitude: 4.6, longitude: -74.1, name: "Casa" } },
          { id: "c", from: "573001", timestamp: "3", type: "request_welcome" },
        ],
      })
    );
    const bodies = events.map((e) => (e.kind === "message" ? e.body : null));
    expect(bodies[0]).toBe("Reaccionó ❤️");
    expect(bodies[1]).toContain("📍 Ubicación: Casa");
    expect(bodies[1]).toContain("maps.google.com");
    expect(bodies[2]).toBe("👋 Abrió el chat");
  });

  test("un mensaje que llega por un anuncio lo dice", () => {
    const events = normalizeMetaPayload(
      wrap({
        messages: [
          {
            id: "d",
            from: "573001",
            timestamp: "4",
            type: "text",
            text: { body: "Info" },
            referral: { headline: "Terapia online" },
          },
        ],
      })
    );
    expect(events[0].kind === "message" && events[0].body).toBe("Info\n(Llegó desde un anuncio: Terapia online)");
  });
});
