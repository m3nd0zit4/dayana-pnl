import { describe, expect, test } from "bun:test";

import { lookupPhone, parseVCards, phoneByName } from "./vcard";

const VCF = [
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N:Pérez;Laura;;;",
  "FN:Laura Pérez",
  "TEL;CELL:+57 300 123 4567",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:2.1",
  "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;Mar=C3=ADa;;;",
  "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mar=C3=ADa Jos=C3=A9",
  "TEL;CELL;PREF:3109876543",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ana",
  "TEL;TYPE=CELL:+52 1 55 1234 5678",
  "TEL;TYPE=HOME:+52 55 0000 0000",
  "END:VCARD",
  "BEGIN:VCARD",
  "FN:Sin número",
  "END:VCARD",
].join("\r\n");

describe("parseVCards", () => {
  test("lee nombres (también con tildes en QUOTED-PRINTABLE) y números", () => {
    const contacts = parseVCards(VCF);
    expect(contacts).toEqual([
      { name: "Laura Pérez", phones: ["+573001234567"] },
      { name: "María José", phones: ["+573109876543"] },
      { name: "Ana", phones: ["+5215512345678", "+525500000000"] },
    ]);
  });

  test("nombre → número solo cuando es único", () => {
    const map = phoneByName(parseVCards(VCF));
    expect(lookupPhone(map, "laura perez")).toBe("+573001234567");
    expect(lookupPhone(map, "María José")).toBe("+573109876543");
    expect(lookupPhone(map, "Ana")).toBeNull(); // dos números: no se adivina
    expect(lookupPhone(map, "Pedro")).toBeNull();
  });
});
