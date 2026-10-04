import { describe, expect, test } from "bun:test";

import { buildMediaPayload, buildTemplatePayload, imageRefPayload } from "./whatsapp-payload";

describe("buildTemplatePayload", () => {
  test("sin variables ni imagen: sin components (como antes)", () => {
    expect(buildTemplatePayload({ name: "hola", language: "es" })).toEqual({
      name: "hola",
      language: { code: "es" },
    });
    expect(buildTemplatePayload({ name: "hola", language: "es", variables: [], headerImage: null })).toEqual({
      name: "hola",
      language: { code: "es" },
    });
  });

  test("solo variables: el body de siempre", () => {
    expect(buildTemplatePayload({ name: "r", language: "es", variables: ["Ana", "la masterclass"] })).toEqual({
      name: "r",
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "la masterclass" },
          ],
        },
      ],
    });
  });

  test("imagen por id: la cabecera va antes del body", () => {
    expect(
      buildTemplatePayload({
        name: "evento_gratis_recordatorio_imagen",
        language: "es",
        variables: ["Ana", "«Reprograma tu mente»", "domingo 4 de octubre a las 9:30 a. m", "https://meet.google.com/abc"],
        headerImage: { id: "1234567890" },
      })
    ).toEqual({
      name: "evento_gratis_recordatorio_imagen",
      language: { code: "es" },
      components: [
        { type: "header", parameters: [{ type: "image", image: { id: "1234567890" } }] },
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ana" },
            { type: "text", text: "«Reprograma tu mente»" },
            { type: "text", text: "domingo 4 de octubre a las 9:30 a. m" },
            { type: "text", text: "https://meet.google.com/abc" },
          ],
        },
      ],
    });
  });

  test("imagen por enlace y sin variables: solo la cabecera", () => {
    expect(
      buildTemplatePayload({ name: "x", language: "es", headerImage: { link: "https://cdn.example.com/a.jpg" } })
    ).toEqual({
      name: "x",
      language: { code: "es" },
      components: [
        { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/a.jpg" } }] },
      ],
    });
  });
});

describe("buildMediaPayload", () => {
  test("imagen con pie", () => {
    expect(buildMediaPayload({ kind: "image", media: { id: "m1" }, caption: "Hola Ana" })).toEqual({
      id: "m1",
      caption: "Hola Ana",
    });
  });

  test("sin pie no lleva caption; el nombre de archivo solo en documentos", () => {
    expect(buildMediaPayload({ kind: "image", media: { id: "m1" }, caption: "", filename: "a.jpg" })).toEqual({
      id: "m1",
    });
    expect(buildMediaPayload({ kind: "document", media: { id: "d1" }, filename: "guia.pdf" })).toEqual({
      id: "d1",
      filename: "guia.pdf",
    });
  });

  test("por enlace", () => {
    expect(buildMediaPayload({ kind: "image", media: { link: "https://x/y.png" }, caption: "c" })).toEqual({
      link: "https://x/y.png",
      caption: "c",
    });
  });
});

describe("imageRefPayload", () => {
  test("deja solo id o solo link", () => {
    const extra = { id: "9", other: "nope" } as unknown as { id: string };
    expect(imageRefPayload(extra)).toEqual({ id: "9" });
    expect(imageRefPayload({ link: "https://x" })).toEqual({ link: "https://x" });
  });
});
