import { describe, expect, test } from "bun:test";

import {
  announceMessage,
  countByStatus,
  e164Candidates,
  matchPhonesToContacts,
  normalizePhoneDigits,
  parsePastedPhones,
  phoneVariants,
} from "./whatsapp-communities-core";
import { STARTER_TEMPLATES, templateBodyProblem } from "./whatsapp-templates";

describe("normalizePhoneDigits", () => {
  test("quita todo lo que no es dígito", () => {
    expect(normalizePhoneDigits("+57 (300) 123-4567")).toBe("573001234567");
  });
  test("00 internacional", () => {
    expect(normalizePhoneDigits("0057 300 123 4567")).toBe("573001234567");
  });
  test("celular colombiano sin indicativo", () => {
    expect(normalizePhoneDigits("300 123 4567")).toBe("573001234567");
  });
  test("muy corto o muy largo: nada", () => {
    expect(normalizePhoneDigits("12345")).toBeNull();
    expect(normalizePhoneDigits("1234567890123456")).toBeNull();
  });
});

describe("phoneVariants", () => {
  test("México con y sin el 1", () => {
    expect(phoneVariants("5215512345678").sort()).toEqual(["525512345678", "5215512345678"].sort());
    expect(phoneVariants("525512345678").sort()).toEqual(["525512345678", "5215512345678"].sort());
  });
  test("Argentina con y sin el 9", () => {
    expect(phoneVariants("5491123456789").sort()).toEqual(["541123456789", "5491123456789"].sort());
    expect(phoneVariants("541123456789").sort()).toEqual(["541123456789", "5491123456789"].sort());
  });
  test("otros países: tal cual", () => {
    expect(phoneVariants("573001234567")).toEqual(["573001234567"]);
  });
});

describe("parsePastedPhones", () => {
  test("lista de la info del grupo con marcas invisibles y nombres", () => {
    const text = "‪+52 1 55 1234 5678‬\n~ Laura: +57 300 123 4567\nTú\n+54 9 11 2345-6789, (300) 123-4567";
    const parsed = parsePastedPhones(text);
    expect(parsed.map((p) => p.digits)).toEqual(["5215512345678", "573001234567", "5491123456789"]);
  });
  test("sin números: vacío", () => {
    expect(parsePastedPhones("hola a todas 💛")).toEqual([]);
  });
  test("candidatos E.164 con variantes", () => {
    expect(e164Candidates(parsePastedPhones("+52 55 1234 5678"))).toEqual(["+525512345678", "+5215512345678"]);
  });
});

describe("matchPhonesToContacts", () => {
  const contacts = [
    { id: "a", phoneE164: "+5215512345678" },
    { id: "b", phoneE164: "+573001234567" },
  ];
  test("encuentra por variante y separa los desconocidos", () => {
    const parsed = parsePastedPhones("+52 55 1234 5678\n+57 300 123 4567\n+57 311 000 0000");
    const res = matchPhonesToContacts(parsed, contacts);
    expect(res.matched.map((m) => m.contact.id)).toEqual(["a", "b"]);
    expect(res.unknown).toEqual(["+57 311 000 0000"]);
  });
  test("la misma persona dos veces cuenta una", () => {
    const parsed = parsePastedPhones("+52 55 1234 5678\n+52 1 55 1234 5678");
    expect(matchPhonesToContacts(parsed, contacts).matched).toHaveLength(1);
  });
});

describe("countByStatus", () => {
  test("filas sueltas y de groupBy", () => {
    expect(countByStatus([{ status: "JOINED" }, { status: "JOINED" }, { status: "INVITED" }, { status: "RARO" }])).toEqual({
      INVITED: 1,
      JOINED: 2,
      LEFT: 0,
      DECLINED: 0,
    });
    expect(countByStatus([{ status: "LEFT", count: 4 }, { status: "DECLINED", count: 2 }])).toEqual({
      INVITED: 0,
      JOINED: 0,
      LEFT: 4,
      DECLINED: 2,
    });
  });
});

describe("announceMessage", () => {
  test("quita el saludo y la «Novedad en …» que ya pone la plantilla", () => {
    expect(announceMessage("Hola {{nombre}}, te bendigo 💛 Novedad en Mujeres que sanan: El jueves hay meditación.", "Mujeres que sanan")).toBe(
      "El jueves hay meditación."
    );
  });
  test("texto propio: queda igual", () => {
    expect(announceMessage("Mañana no hay sesión.", "Grupo")).toBe("Mañana no hay sesión.");
  });
});

describe("plantillas de comunidad", () => {
  test("existen y pasan las reglas de Meta", () => {
    for (const key of ["comunidad_invitacion", "comunidad_anuncio"]) {
      const t = STARTER_TEMPLATES.find((s) => s.key === key);
      expect(t).toBeDefined();
      expect(templateBodyProblem(t!.body)).toBeNull();
    }
  });
});
