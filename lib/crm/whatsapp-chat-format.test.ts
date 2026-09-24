import { describe, expect, test } from "bun:test";

import {
  QUICK_REACTIONS,
  calendarDaysAgo,
  dateSeparatorLabel,
  documentName,
  documentType,
  foldForSearch,
  highlightParts,
  matchesSearch,
  quotePreview,
  sameDay,
  searchMessages,
  stepMatch,
} from "./whatsapp-chat-format";

// Jueves 24 de septiembre de 2026, 10:00 hora local.
const NOW = new Date(2026, 8, 24, 10, 0);

describe("dateSeparatorLabel", () => {
  test("hoy, también a primera hora", () => {
    expect(dateSeparatorLabel(new Date(2026, 8, 24, 0, 5), NOW)).toBe("Hoy");
    expect(dateSeparatorLabel(new Date(2026, 8, 24, 23, 59), NOW)).toBe("Hoy");
  });

  test("ayer es el día de calendario anterior, no «hace 24 h»", () => {
    expect(dateSeparatorLabel(new Date(2026, 8, 23, 23, 59), NOW)).toBe("Ayer");
    expect(dateSeparatorLabel(new Date(2026, 8, 23, 0, 1), NOW)).toBe("Ayer");
  });

  test("día de la semana dentro de la última semana", () => {
    expect(dateSeparatorLabel(new Date(2026, 8, 22, 12), NOW)).toBe("Martes");
    expect(dateSeparatorLabel(new Date(2026, 8, 18, 12), NOW)).toBe("Viernes");
  });

  test("hace 7 días o más: la fecha", () => {
    expect(dateSeparatorLabel(new Date(2026, 8, 17, 12), NOW)).toBe("17 de septiembre");
    expect(dateSeparatorLabel(new Date(2026, 8, 12, 12), NOW)).toBe("12 de septiembre");
  });

  test("otro año lleva el año", () => {
    expect(dateSeparatorLabel(new Date(2025, 11, 31, 12), NOW)).toBe("31 de diciembre de 2025");
  });

  test("acepta ISO", () => {
    expect(dateSeparatorLabel(new Date(2026, 8, 24, 8).toISOString(), NOW)).toBe("Hoy");
  });

  test("cruce de mes", () => {
    const now = new Date(2026, 9, 1, 9);
    expect(dateSeparatorLabel(new Date(2026, 8, 30, 22), now)).toBe("Ayer");
    expect(calendarDaysAgo(new Date(2026, 8, 30, 22), now)).toBe(1);
  });

  test("sameDay", () => {
    expect(sameDay(new Date(2026, 8, 24, 0, 1), new Date(2026, 8, 24, 23, 59))).toBe(true);
    expect(sameDay(new Date(2026, 8, 24, 0, 1), new Date(2026, 8, 23, 23, 59))).toBe(false);
  });
});

describe("búsqueda en el chat", () => {
  test("sin mayúsculas ni tildes", () => {
    expect(matchesSearch("¿Mañana a qué HORA?", "manana")).toBe(true);
    expect(matchesSearch("Sesión de terapia", "SESION")).toBe(true);
    expect(matchesSearch("hola", "adiós")).toBe(false);
  });

  test("búsqueda vacía o texto nulo no coinciden", () => {
    expect(matchesSearch("hola", "   ")).toBe(false);
    expect(matchesSearch(null, "hola")).toBe(false);
  });

  test("plegar no cambia la longitud (para resaltar en el original)", () => {
    const text = "Él está ÁNIMO 💛 ñ";
    expect(foldForSearch(text).length).toBe(text.length);
  });

  test("resalta en el texto original, todas las veces", () => {
    expect(highlightParts("Mañana y MAÑANA", "manana")).toEqual([
      { text: "Mañana", match: true },
      { text: " y ", match: false },
      { text: "MAÑANA", match: true },
    ]);
    expect(highlightParts("hola", "")).toEqual([{ text: "hola", match: false }]);
    expect(highlightParts("hola", "x")).toEqual([{ text: "hola", match: false }]);
  });

  test("busca en el texto y en el pie de los archivos, en orden", () => {
    const ids = searchMessages(
      [
        { id: "a", body: "Te mando el PDF", attachments: [] },
        { id: "b", body: null, attachments: [{ caption: "pdf de la factura" }] },
        { id: "c", body: "otra cosa", attachments: [] },
      ],
      "pdf"
    );
    expect(ids).toEqual(["a", "b"]);
    expect(searchMessages([{ id: "a", body: "x" }], "")).toEqual([]);
  });

  test("las flechas dan la vuelta", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});

describe("citas y documentos", () => {
  test("la cita usa el texto o el tipo de archivo", () => {
    expect(quotePreview({ body: "hola", attachments: [] })).toBe("hola");
    expect(quotePreview({ body: null, attachments: [{ kind: "image", caption: null }] })).toBe("📷 Foto");
    expect(quotePreview({ body: "", attachments: [] })).toBe("Mensaje");
    expect(quotePreview({ body: "x".repeat(300), attachments: [] }).length).toBe(158);
  });

  test("nombre del documento: nombre, pie o final de la URL", () => {
    expect(documentName({ url: null, caption: null, filename: "Factura.pdf" })).toBe("Factura.pdf");
    expect(documentName({ url: null, caption: "Contrato firmado" })).toBe("Contrato firmado");
    expect(documentName({ url: "https://x.blob.vercel-storage.com/inbox/abc%20def.pdf", caption: null })).toBe("abc def.pdf");
    expect(documentName({ url: null, caption: null })).toBe("Documento");
  });

  test("tipo del documento", () => {
    expect(documentType("application/pdf")).toBe("PDF");
    expect(documentType(null, "notas.docx")).toBe("DOCX");
    expect(documentType("application/octet-stream")).toBe("OCTET-");
    expect(documentType(null)).toBe("Archivo");
  });

  test("seis reacciones rápidas", () => {
    expect(QUICK_REACTIONS).toEqual(["👍", "❤️", "😂", "😮", "😢", "🙏"]);
  });
});
