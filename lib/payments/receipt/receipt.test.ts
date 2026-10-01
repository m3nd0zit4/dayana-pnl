import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import { BRAND } from "@/lib/contact";
import { emailFrom } from "@/lib/notifications/config";
import type { ReceiptData } from "./data";
import { renderReceiptPdf } from "./document";
import { pdfText, pdfTextOrNull } from "./text";

describe("pdfText", () => {
  test("recompone la tilde suelta y quita el emoji", () => {
    // «a» + U+0301 (tilde combinante) y un corazón amarillo.
    expect(pdfText("Beltra\u{301}n \u{1F49B}")).toBe("Beltrán");
  });

  test("quita secuencias ZWJ, tonos de piel, banderas y selectores", () => {
    expect(pdfText("Ana \u{1F469}\u{1F3FD}\u{200D}\u{1F4BB} Gómez")).toBe(
      "Ana Gómez"
    );
    expect(pdfText("Colombia \u{1F1E8}\u{1F1F4}")).toBe("Colombia");
    expect(pdfText("\u{2764}\u{FE0F} María")).toBe("María");
    expect(pdfText("Sesión 1\u{FE0F}\u{20E3}")).toBe("Sesión 1");
  });

  test("quita U+FFFD y marcas combinantes que NFC no compone", () => {
    expect(pdfText("Beltr\u{FFFD}n")).toBe("Beltrn");
    expect(pdfText("Zoe\u{308}\u{332}")).toBe("Zoë");
  });

  test("colapsa espacios y saltos de línea", () => {
    expect(pdfText("  Sesión\n\tindividual\u{A0} de\u{200B} PNL  ")).toBe(
      "Sesión individual de PNL"
    );
  });

  test("respeta la puntuación del español", () => {
    expect(pdfText("¿Pagó? ¡Sí! — 50 € «gracias» · Ñandú")).toBe(
      "¿Pagó? ¡Sí! — 50 € «gracias» · Ñandú"
    );
  });

  test("opcional: vacío tras limpiar es ausente", () => {
    expect(pdfTextOrNull("\u{1F49B}")).toBeNull();
    expect(pdfTextOrNull(null)).toBeNull();
    expect(pdfTextOrNull(" CO ")).toBe("CO");
  });
});

describe("emailFrom: nombre del remitente", () => {
  const KEY = "NOTIFICATIONS_EMAIL_FROM_NAME";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  test("un valor con «?» viene de una terminal sin UTF-8 y se ignora", () => {
    process.env[KEY] = "Dayana Beltr?n PNL";
    expect(emailFrom().name).toBe(BRAND.shortName);
  });

  test("un valor con U+FFFD se ignora", () => {
    process.env[KEY] = "Dayana Beltr\u{FFFD}n PNL";
    expect(emailFrom().name).toBe(BRAND.shortName);
  });

  test("sin valor cae a la marca", () => {
    delete process.env[KEY];
    expect(emailFrom().name).toBe("Dayana Beltrán PNL");
  });

  test("un valor sano se respeta, normalizado a NFC", () => {
    process.env[KEY] = "Equipo Dayana";
    expect(emailFrom().name).toBe("Equipo Dayana");
    process.env[KEY] = "Dayana Beltra\u{301}n";
    expect(emailFrom().name).toBe("Dayana Beltrán");
  });
});

// Saca los streams del PDF y descomprime los que vienen con Flate, para poder
// mirar el ToUnicode de las fuentes incrustadas.
const pdfStreams = (pdf: Buffer): string[] => {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  const re = />>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const bytes = pdf.subarray(start, end);
    try {
      out.push(inflateSync(bytes).toString("latin1"));
    } catch {
      out.push(bytes.toString("latin1"));
    }
    re.lastIndex = end + "endstream".length;
  }
  return out;
};

describe("renderReceiptPdf", () => {
  const sample: ReceiptData = {
    receiptNumber: "REC-2026-0001",
    paidAtLabel: "2026-10-01 · 09:30 (hora de Colombia)",
    emitter: {
      name: BRAND.shortName,
      email: "contacto@dayanabeltran.com",
      site: "dayanabeltran.com",
    },
    payer: {
      name: "Beltrán Ñandú ¿¡ €",
      email: "cliente@example.com",
      countryIso: "CO",
    },
    concept: "Sesión de PNL — acompañamiento",
    currency: "COP",
    totalLabel: "250.000",
    feeLabel: "12.500",
    netLabel: "237.500",
    method: "Mercado Pago",
    providerReference: "MP-123456789",
    sessions: 4,
  };

  test(
    "incrusta Arimo y escribe las tildes como Unicode, sin Helvetica",
    async () => {
      const pdf = await renderReceiptPdf(sample);
      const raw = pdf.toString("latin1");

      expect(raw.startsWith("%PDF")).toBe(true);
      expect(raw).toContain("/FontFile2");
      expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+Arimo-Regular/);
      expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+Arimo-Bold/);
      expect(raw).not.toContain("/BaseFont /Helvetica");

      const cmaps = pdfStreams(pdf)
        .filter((s) => s.includes("beginbfrange"))
        .join("\n");
      // á Ñ ú ¿ ¡ € — cada una mapeada a su código Unicode real.
      for (const hex of ["00e1", "00d1", "00fa", "00bf", "00a1", "20ac"]) {
        expect(cmaps).toContain(`<${hex}>`);
      }
      // Ningún texto del recibo lleva «?»: si aparece, algo se sustituyó.
      expect(cmaps).not.toContain("<003f>");
    },
    30_000
  );
});
