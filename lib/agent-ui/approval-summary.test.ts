import { describe, expect, test } from "bun:test";

import { genericLines, looksLikeId, summarizeApproval } from "./approval-summary";

const CONTACT_ID = "cmh3x9k2a0001qz8l4n7v2b5d";
const names = { [CONTACT_ID]: "Ana Pérez", enr_1: "Ana Pérez · Terapia 3 sesiones", prod_1: "Terapia 1 sesión" };

const value = (summary: ReturnType<typeof summarizeApproval>, label: string) =>
  summary.lines.find((l) => l.label === label)?.value;

describe("summarizeApproval: sends", () => {
  test("WhatsApp to a contact names who receives it and shows the text", () => {
    const s = summarizeApproval("send_whatsapp_to_contact", { contactId: CONTACT_ID, text: "Hola Ana, te comparto el enlace" }, { names });
    expect(s.title).toBe("Enviar WhatsApp");
    expect(s.access).toBe("execute");
    expect(s.recipient).toBe("Ana Pérez");
    expect(value(s, "Mensaje")).toBe("Hola Ana, te comparto el enlace");
    expect(JSON.stringify(s)).not.toContain(CONTACT_ID);
  });

  test("an unknown contact id never leaks: generic recipient", () => {
    const s = summarizeApproval("send_contact_sms", { contactId: CONTACT_ID, body: "Tu cita es mañana" });
    expect(s.recipient).toBe("el contacto elegido");
    expect(value(s, "Mensaje")).toBe("Tu cita es mañana");
  });

  test("email shows subject, body and button", () => {
    const s = summarizeApproval(
      "send_contact_email",
      { contactId: CONTACT_ID, subject: "Tu taller", body: "Hola Ana…", ctaLabel: "Ver taller", ctaUrl: "https://x.co/t" },
      { names }
    );
    expect(s.recipient).toBe("Ana Pérez");
    expect(value(s, "Asunto")).toBe("Tu taller");
    expect(value(s, "Botón")).toBe("Ver taller → https://x.co/t");
  });

  test("bulk WhatsApp to event registrants; dry run says nothing goes out", () => {
    const s = summarizeApproval("send_whatsapp_bulk", { audience: "event_registrants", message: "recordatorio", dryRun: true });
    expect(s.recipient).toBe("Inscritas del evento gratuito");
    expect(value(s, "Mensaje")).toBe("Recordatorio");
    expect(s.note).toContain("simulación");
  });

  test("bulk WhatsApp to a contact list counts them", () => {
    const s = summarizeApproval("send_whatsapp_bulk", { audience: "contacts", contactIds: ["a", "b", "c"], message: "libre", text: "Hola", dryRun: false });
    expect(s.recipient).toBe("3 contactos");
    expect(value(s, "Mensaje")).toBe("Hola");
  });

  test("bulk email audience in words", () => {
    const s = summarizeApproval("send_bulk_email", { name: "Noviembre", templateKey: "taller_nov", audience: "MARKETING_CONSENT" });
    expect(s.recipient).toBe("Contactos que aceptaron recibir novedades");
    expect(value(s, "Campaña")).toBe("Noviembre");
  });
});

describe("summarizeApproval: money", () => {
  test("manual payment in COP whole pesos, code hidden", () => {
    const s = summarizeApproval(
      "record_manual_payment",
      { enrollmentId: "enr_1", amountMinor: 190000, currency: "cop", reference: "Nequi 123", code: "482913" },
      { names }
    );
    expect(s.access).toBe("execute");
    expect(s.recipient).toBe("Ana Pérez · Terapia 3 sesiones");
    expect(value(s, "Monto")).toBe("190.000 COP");
    expect(value(s, "Referencia")).toBe("Nequi 123");
    expect(JSON.stringify(s)).not.toContain("482913");
  });

  test("manual payment in USD cents", () => {
    const s = summarizeApproval("record_manual_payment", { enrollmentId: "x", amountMinor: 5999, currency: "USD", code: "1234" });
    expect(value(s, "Monto")).toBe("59.99 USD");
  });

  test("price change says who sees it", () => {
    const s = summarizeApproval("update_product_price", { productId: "prod_1", amountUsd: 60, amountCop: 230000 }, { names });
    expect(s.recipient).toBe("Todas las personas que vean Terapia 1 sesión");
    expect(value(s, "Precio USD")).toBe("60 USD");
    expect(value(s, "Precio COP")).toBe("230.000 COP");
  });

  test("exchange rate", () => {
    const s = summarizeApproval("update_usd_to_cop_rate", { rate: 3900 });
    expect(value(s, "Nueva tasa")).toBe("1 USD = 3.900 COP");
  });

  test("promo code percent", () => {
    const s = summarizeApproval("create_promo_code", { code: "NOV20", discountType: "PERCENT", percentOff: 20, maxRedemptions: 10 });
    expect(s.access).toBe("edit");
    expect(value(s, "Código")).toBe("NOV20");
    expect(value(s, "Descuento")).toBe("20 %");
    expect(value(s, "Usos máximos")).toBe("10");
  });
});

describe("summarizeApproval: edits", () => {
  test("contact creation", () => {
    const s = summarizeApproval("create_contact", { phone: "+57 300 123 4567", firstName: "Ana", lastName: "Pérez" });
    expect(value(s, "Nombre")).toBe("Ana Pérez");
    expect(value(s, "Teléfono")).toBe("+57 300 123 4567");
    expect(s.recipient).toBeUndefined();
  });

  test("workshop opening warns it closes the other", () => {
    const s = summarizeApproval("update_workshop", { slug: "sanacion", title: "Sanación", status: "OPEN", priceCop: 150000, capacity: 0 });
    expect(value(s, "Estado")).toBe("Inscripciones abiertas");
    expect(value(s, "Cupo")).toBe("Sin límite");
    expect(value(s, "Precio COP")).toBe("150.000 COP");
    expect(s.note).toContain("cierra");
  });

  test("calendar event with guests", () => {
    const s = summarizeApproval("create_calendar_event", {
      summary: "Sesión Ana",
      startIso: "2026-11-10T15:00:00-05:00",
      endIso: "2026-11-10T16:00:00-05:00",
      attendeeEmails: ["ana@x.co"],
      withMeet: true,
    });
    expect(value(s, "Evento")).toBe("Sesión Ana");
    expect(value(s, "Cuándo")).toMatch(/^10 nov 2026, 3:00\sp\.\s?m\.\s–\s4:00\sp\.\s?m\.$/);
    expect(value(s, "Invitados")).toBe("ana@x.co");
    expect(s.recipient).toBe("1 invitado por correo");
  });

  test("memory add / replace / remove", () => {
    expect(value(summarizeApproval("memory", { action: "add", content: "Llamar a la clienta «tú»" }), "Recordar")).toBe("Llamar a la clienta «tú»");
    const replace = summarizeApproval("memory", { action: "replace", match: "viejo", content: "nuevo", scope: "ventas" });
    expect(value(replace, "Antes")).toBe("viejo");
    expect(value(replace, "Ahora")).toBe("nuevo");
    expect(value(replace, "Para")).toBe("Ventas");
    expect(value(summarizeApproval("memory", { action: "remove", match: "x" }), "Olvidar")).toBe("x");
  });

  test("chat mode in words", () => {
    const s = summarizeApproval("whatsapp_set_chat", { conversationId: "conv_1", mode: "MANUAL" }, { names: { conv_1: "Laura" } });
    expect(value(s, "Chat")).toBe("Laura");
    expect(value(s, "Quién responde")).toBe("Responde Dayana");
  });
});

describe("summarizeApproval: fallback", () => {
  test("unknown tool: readable title, primitive fields, ids hidden", () => {
    const s = summarizeApproval("frobnicate_widget", {
      widgetId: "w1",
      ownerRef: CONTACT_ID,
      displayName: "Algo",
      isActive: true,
      startsAt: "2026-11-10T15:00:00Z",
      nested: { a: 1 },
      tags: ["a", "b"],
    });
    expect(s.title).toBe("Frobnicate widget");
    expect(s.access).toBe("edit");
    const labels = s.lines.map((l) => l.label);
    expect(labels).toContain("Nombre");
    expect(labels).toContain("Activo");
    expect(labels).toContain("Tags");
    expect(JSON.stringify(s)).not.toContain(CONTACT_ID);
    expect(JSON.stringify(s)).not.toContain("w1");
    expect(value(s, "Activo")).toBe("Sí");
  });

  test("long strings are cut", () => {
    const [line] = genericLines({ summary: "x ".repeat(300) });
    expect(line.value.length).toBeLessThanOrEqual(220);
    expect(line.value.endsWith("…")).toBe(true);
  });

  test("non-object input gives no lines", () => {
    expect(summarizeApproval("create_contact", null).lines).toEqual([]);
  });

  test("looksLikeId", () => {
    expect(looksLikeId(CONTACT_ID)).toBe(true);
    expect(looksLikeId("3f2b1c4d-1234-4abc-9def-0123456789ab")).toBe(true);
    expect(looksLikeId("Ana Pérez")).toBe(false);
    expect(looksLikeId("NOV20")).toBe(false);
  });
});
