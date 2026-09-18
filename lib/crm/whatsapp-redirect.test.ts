import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  decodeWhatsAppRedirect,
  encodeWhatsAppRedirect,
  rewriteWhatsAppLinks,
} from "./whatsapp-redirect";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-whatsapp-redirect";
});
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

const payload = {
  contactId: "ckcontact123",
  source: "email:payment_approved",
  kind: "lead" as const,
  target: "https://wa.me/573105833188?text=Hola%20Dayana",
};

describe("encode / decode", () => {
  test("ida y vuelta conserva los datos", () => {
    expect(decodeWhatsAppRedirect(encodeWhatsAppRedirect(payload))).toEqual(payload);
  });

  test("el tipo staff se conserva", () => {
    const code = encodeWhatsAppRedirect({ ...payload, kind: "staff" });
    expect(decodeWhatsAppRedirect(code)?.kind).toBe("staff");
  });

  test("una firma alterada se rechaza", () => {
    const code = encodeWhatsAppRedirect(payload);
    const tampered = code.slice(0, -1) + (code.endsWith("A") ? "B" : "A");
    expect(decodeWhatsAppRedirect(tampered)).toBeNull();
  });

  test("otro contacto con la firma original se rechaza", () => {
    const code = encodeWhatsAppRedirect(payload);
    const [, signature] = code.split(".");
    const forged = Buffer.from(
      JSON.stringify({ c: "otra-ficha", s: payload.source, k: "l", t: payload.target }),
    ).toString("base64url");
    expect(decodeWhatsAppRedirect(`${forged}.${signature}`)).toBeNull();
  });

  test("con otra clave no verifica", () => {
    const code = encodeWhatsAppRedirect(payload);
    process.env.AUTH_SECRET = "otra-clave";
    expect(decodeWhatsAppRedirect(code)).toBeNull();
  });

  test("basura no revienta", () => {
    expect(decodeWhatsAppRedirect("")).toBeNull();
    expect(decodeWhatsAppRedirect("sin-punto")).toBeNull();
    expect(decodeWhatsAppRedirect(".solo-firma")).toBeNull();
  });

  test("sólo destinos de WhatsApp: no es una redirección abierta", () => {
    expect(() =>
      encodeWhatsAppRedirect({ ...payload, target: "https://evil.example/wa.me/" }),
    ).toThrow();
    expect(() =>
      encodeWhatsAppRedirect({ ...payload, target: "http://wa.me/573105833188" }),
    ).toThrow();
  });
});

describe("rewriteWhatsAppLinks", () => {
  const input = {
    siteUrl: "https://www.dayanabeltran.com/",
    contactId: "ckcontact123",
    source: "email:test",
    kind: "lead" as const,
  };

  test("reescribe wa.me y deja el resto de enlaces", () => {
    const html =
      '<a href="https://wa.me/573105833188?text=Hola&amp;x=1">escribir</a>' +
      '<a href="https://www.dayanabeltran.com/cuenta">cuenta</a>';
    const out = rewriteWhatsAppLinks(html, input);

    expect(out).toContain('href="https://www.dayanabeltran.com/w/');
    expect(out).toContain('<a href="https://www.dayanabeltran.com/cuenta">');
    expect(out).not.toContain("https://wa.me/");

    const code = out.match(/\/w\/([^"]+)"/)![1];
    const decoded = decodeWhatsAppRedirect(code);
    // El destino firmado es la URL real, con `&` y no `&amp;`.
    expect(decoded?.target).toBe("https://wa.me/573105833188?text=Hola&x=1");
    expect(decoded?.contactId).toBe("ckcontact123");
  });

  test("api.whatsapp.com también cuenta", () => {
    const out = rewriteWhatsAppLinks(
      '<a href="https://api.whatsapp.com/send?phone=573105833188">x</a>',
      input,
    );
    expect(out).toContain("/w/");
  });

  test("sin enlaces de WhatsApp, el HTML no cambia", () => {
    const html = "<p>Hola</p>";
    expect(rewriteWhatsAppLinks(html, input)).toBe(html);
  });
});
