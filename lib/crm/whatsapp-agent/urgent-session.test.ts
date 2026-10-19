import { describe, expect, test } from "bun:test";

import { defaultWhatsAppAiConfig } from "../whatsapp-ai-config";
import {
  asksForNow,
  offersUrgentSession,
  urgencyInsisted,
  urgentLinkSent,
  urgentSessionPath,
  urgentSessionRules,
  withoutFakeLinks,
} from "./urgent-session";

type L = { direction: "INBOUND" | "OUTBOUND"; body: string; sentAt?: Date };
const t0 = new Date("2026-10-19T00:55:00Z");
const chat = (...lines: [string, string][]): L[] =>
  lines.map(([who, body], i) => ({ direction: who === "p" ? "INBOUND" : "OUTBOUND", body, sentAt: new Date(t0.getTime() + i * 30_000) }));

// El chat de «CM7 ⚽🥅» (18-oct, 7:55 p. m.), tal cual hasta su insistencia.
const CM7 = chat(
  ["p", "Hola amor"],
  ["a", "Hola, te bendigo. Soy la asistente de Dayana. ¿Cómo estás?"],
  ["p", "Muy bien y tu"],
  ["a", "Muy bien, con la bendición de Dios. ¿Desde qué país me escribes?"],
  ["p", "Colombia"],
  ["p", "Oye amor"],
  ["a", "Te bendigo. Estoy muy bien, gracias a Dios."],
  ["p", "Te puedo hacer llamada"],
  ["a", "Las llamadas se hacen mediante una cita previa con Dayana, sin costo. Si quieres, te agendo una llamada gratis de 15 minutos con ella."],
  ["p", "Si por favor"],
  ["p", "Hoy"],
  ["p", "Mismo"],
  ["a", "Para hoy ya no tenemos espacios libres en la agenda de Dayana. Te tengo disponibilidad para el jueves, 22 de octubre, a las 7:00 p. m. o el viernes, 23 de octubre, a las 9:45 p. m. ¿Te sirve alguna?"],
  ["p", "Es que es rápido"],
  ["p", "Necesitaba hablar con ella"]
);

describe("asksForNow", () => {
  test("urgencia clara", () => {
    for (const s of ["Es que es rápido", "Necesitaba hablar con ella", "hoy mismo porfa", "es urgente", "lo antes posible", "No puedo esperar"]) {
      expect(asksForNow(s)).toBe(true);
    }
  });
  test("«hoy» solo en un mensaje corto o junto a llamar", () => {
    expect(asksForNow("Hoy")).toBe(true);
    expect(asksForNow("¿Me puede llamar hoy?")).toBe(true);
    expect(asksForNow("Hoy me siento muy triste por lo que pasó")).toBe(false);
  });
  test("lo contrario no cuenta", () => {
    expect(asksForNow("Hoy no puedo")).toBe(false);
    expect(asksForNow("ahora no")).toBe(false);
    expect(asksForNow("Muy bien y tu")).toBe(false);
  });
});

describe("urgencyInsisted", () => {
  test("CM7: pidió hoy, le ofrecieron el jueves e insistió", () => {
    const r = urgencyInsisted(CM7);
    expect(r.insisted).toBe(true);
    expect(r.asks).toEqual(["Si por favor Hoy Mismo", "Es que es rápido Necesitaba hablar con ella"]);
  });

  test("pedirlo una sola vez no basta", () => {
    expect(urgencyInsisted(CM7.slice(0, 12)).insisted).toBe(false);
  });

  test("si lo último que dice no es urgente, no", () => {
    expect(urgencyInsisted([...CM7, ...chat(["a", "Entiendo."], ["p", "Bueno, el jueves entonces"])]).insisted).toBe(false);
  });

  test("dos urgencias sin respuesta con horas en el medio no cuentan", () => {
    const lines = chat(["p", "es urgente"], ["a", "Te bendigo, cuéntame qué te pasa."], ["p", "necesito hablar con ella"]);
    expect(urgencyInsisted(lines).insisted).toBe(false);
  });

  test("hace más de 6 h ya no es la urgencia de ahora", () => {
    const old = chat(["p", "hoy mismo"], ["a", "Para hoy no hay espacio; ¿te sirve el jueves a las 7:00 p. m.?"]);
    const later = chat(["p", "es que es rápido"]).map((l) => ({ ...l, sentAt: new Date(t0.getTime() + 8 * 3600_000) }));
    expect(urgencyInsisted([...old, ...later]).insisted).toBe(false);
  });
});

describe("config y enlace", () => {
  test("encendida por defecto con la sesión de 1 hora", () => {
    const config = defaultWhatsAppAiConfig();
    expect(urgentSessionPath(config)).toBe("/pagar/p/therapy-1");
    expect(urgentSessionRules(config)).toContain("send_urgent_session_link");
  });
  test("apagada: sin regla", () => {
    const config = defaultWhatsAppAiConfig();
    config.urgentSession.enabled = false;
    expect(urgentSessionPath(config)).toBeNull();
    expect(urgentSessionRules(config)).toBe("");
  });
  test("no se repite el enlace", () => {
    const url = "https://www.dayanabeltran.com/pagar/p/therapy-1";
    expect(urgentLinkSent(chat(["a", url]), url)).toBe(true);
    expect(urgentLinkSent(CM7, url)).toBe(false);
  });
});

describe("lo que escribe el modelo", () => {
  test("reconoce la oferta", () => {
    expect(offersUrgentSession("Si necesitas hablar con Dayana hoy, puedes tomar una sesión privada de 1 hora con ella.")).toBe(true);
    expect(offersUrgentSession("¿Te sirve el jueves a las 7:00 p. m.?")).toBe(false);
  });
  test("quita el enlace inventado y el separador", () => {
    const written =
      "Entiendo que es urgente. Si necesitas hablar con Dayana hoy, puedes tomar una sesión privada de 1 hora con ella por Google Meet. Aquí puedes hacer el pago\n\n***\n* *Sesión urgente 1 hora* (Google Meet) — [Pagar aquí](https://api.whatsapp.com/send?phone=573000000000)";
    expect(withoutFakeLinks(written)).toBe(
      "Entiendo que es urgente. Si necesitas hablar con Dayana hoy, puedes tomar una sesión privada de 1 hora con ella por Google Meet. Aquí puedes hacer el pago"
    );
  });
  test("y el título en negrita que repite el enlace", () => {
    expect(withoutFakeLinks("Aquí puedes hacer el pago\n\n*Sesión urgente de 1 hora por Google Meet con Dayana Beltrán*")).toBe("Aquí puedes hacer el pago");
    expect(withoutFakeLinks("Es *muy* importante")).toBe("Es *muy* importante");
  });
});
