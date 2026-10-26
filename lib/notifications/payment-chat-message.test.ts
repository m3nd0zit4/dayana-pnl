import { describe, expect, test } from "bun:test";

import { paymentChatMessage } from "./payment-chat-message";

const TALLER = "Sana Tu Relación con el Dinero";

describe("paymentChatMessage: el WhatsApp cuando entra un pago (Natividad, Victorino, 25-oct)", () => {
  test("taller pagado por la página: gracias y Dayana confirma; nada de sesiones ni «recibimos tu pago»", () => {
    const m = paymentChatMessage({ firstName: "Victorino", product: TALLER, kind: "WORKSHOP", provider: "PAYPAL", sessions: null });
    expect(m).toBe(
      "Hola Victorino 🙏 Gracias por inscribirte al taller «Sana Tu Relación con el Dinero». Dayana revisa tu pago y te confirma por aquí; antes del taller te compartimos los detalles."
    );
    expect(m).not.toMatch(/sesiones|recibimos tu pago|primera cita/i);
  });
  test("taller que registró Dayana: ella ya lo confirmó, el cupo queda separado", () => {
    expect(paymentChatMessage({ firstName: "Gina", product: TALLER, kind: "WORKSHOP", provider: "MANUAL", sessions: 0 })).toBe(
      "Hola Gina 🙏 Dayana confirmó tu pago ✅ Ya quedó separado tu cupo en el taller «Sana Tu Relación con el Dinero». Antes del taller te compartimos los detalles por aquí."
    );
  });
  test("terapia con sesiones: Dayana la revisa y le escribe para agendar", () => {
    expect(paymentChatMessage({ firstName: "Rosa", product: "Paquete de 3 sesiones", kind: "THERAPY", provider: "MERCADO_PAGO", sessions: 3 })).toBe(
      "Hola Rosa 🙏 Gracias por tu pago de «Paquete de 3 sesiones». Dayana lo revisa y te escribe por aquí para agendar tus sesiones."
    );
  });
  test("sin sesiones (curso, pago personalizado): sin hablar de sesiones", () => {
    const m = paymentChatMessage({ firstName: "Ana", product: "Curso en vivo", kind: "COURSE", provider: "PAYPAL", sessions: 0 });
    expect(m).toBe("Hola Ana 🙏 Gracias por tu pago de «Curso en vivo». Dayana lo revisa y te confirma por aquí.");
  });
  test("la ficha temporal «Pendiente» no se saluda por ese nombre", () => {
    expect(paymentChatMessage({ firstName: "Pendiente", product: TALLER, kind: "WORKSHOP", provider: "MERCADO_PAGO", sessions: null })).toMatch(/^Hola 🙏 Gracias/);
    expect(paymentChatMessage({ firstName: null, product: TALLER, kind: "WORKSHOP", provider: "MERCADO_PAGO", sessions: null })).toMatch(/^Hola 🙏 /);
  });
});
