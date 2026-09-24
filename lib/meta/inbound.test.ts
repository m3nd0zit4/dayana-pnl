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

describe("archivos que «no cargaban»", () => {
  test("un video mandado como archivo se guarda como video", () => {
    const [m] = normalizeMetaPayload(
      wrap({
        messages: [
          { id: "v", from: "573001", timestamp: "1", type: "document", document: { id: "media1", mime_type: "video/mp4", filename: "clip.mp4" } },
        ],
      })
    );
    expect(m.kind === "message" && m.attachments[0]?.kind).toBe("video");
  });
  test("un PDF sigue siendo documento", () => {
    const [m] = normalizeMetaPayload(
      wrap({
        messages: [
          { id: "d", from: "573001", timestamp: "1", type: "document", document: { id: "media2", mime_type: "application/pdf" } },
        ],
      })
    );
    expect(m.kind === "message" && m.attachments[0]?.kind).toBe("document");
  });
  test("un tipo nuevo sin archivo dice qué es, no un adjunto vacío", () => {
    const [m] = normalizeMetaPayload(
      wrap({ messages: [{ id: "p", from: "573001", timestamp: "1", type: "poll", poll: { question: "¿?" } }] })
    );
    expect(m.kind === "message" && m.attachments).toHaveLength(0);
    expect(m.kind === "message" && m.body).toContain("tipo «poll»");
  });
});

describe("mensajes fantasma y avisos de sistema", () => {
  const one = (m: Record<string, unknown>) => normalizeMetaPayload(wrap({ messages: [{ id: "u", from: "573001", timestamp: "1", ...m }] }));

  test("un marcador interno no es un mensaje: no se guarda nada", () => {
    expect(one({ type: "unsupported", unsupported: { type: "media_placeholder" } })).toHaveLength(0);
    expect(one({ type: "unsupported", unsupported: { type: "keep_in_chat" } })).toHaveLength(0);
    expect(one({ type: "unsupported", unsupported: { type: "pin" } })).toHaveLength(0);
  });
  test("una encuesta o un editado es un aviso gris, no algo que la persona escribió", () => {
    const [poll] = one({ type: "unsupported", unsupported: { type: "poll_creation" } });
    expect(poll.kind === "message" && poll.system).toBe(true);
    expect(poll.kind === "message" && poll.body).toContain("encuesta");
    const [edit] = one({ type: "unsupported", unsupported: { type: "edit" } });
    expect(edit.kind === "message" && edit.system && edit.body).toContain("Editó");
  });
  test("errores de WhatsApp (131051) dicen qué pasó", () => {
    const [m] = one({ type: "unknown", errors: [{ code: 131051, title: "Unsupported message type" }] });
    expect(m.kind === "message" && m.system).toBe(true);
    expect(m.kind === "message" && m.body).toContain("131051");
  });
  test("una reacción no despierta a la IA", () => {
    const [r] = one({ type: "reaction", reaction: { emoji: "❤️", message_id: "x" } });
    expect(r.kind === "message" && r.system).toBe(true);
  });
  test("un texto normal no es aviso", () => {
    const [t] = one({ type: "text", text: { body: "Hola" } });
    expect(t.kind === "message" && t.system).toBeFalsy();
  });
});
