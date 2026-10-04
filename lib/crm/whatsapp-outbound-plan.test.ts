import { describe, expect, test } from "bun:test";

import {
  approvalDelivery,
  fillVars,
  firstName,
  HEADER_IMAGE_MIME_VAR,
  HEADER_IMAGE_URL_VAR,
  HEADER_IMAGE_VAR,
  headerImageProblem,
  IMAGE_CAPTION_MAX,
  isOptOutMessage,
  planSend,
  splitImageCaption,
  splitSendVars,
  summarizePlans,
  templateParams,
  windowNotice,
  windowStateOf,
} from "./whatsapp-outbound-plan";

describe("planSend", () => {
  test("dentro de 24 h: texto libre", () => {
    expect(planSend({ hasPhone: true, optedOut: false, windowOpen: true, hasApprovedTemplate: false })).toEqual({
      action: "text",
    });
  });
  test("fuera de 24 h: plantilla si hay, si no se salta", () => {
    expect(planSend({ hasPhone: true, optedOut: false, windowOpen: false, hasApprovedTemplate: true })).toEqual({
      action: "template",
    });
    expect(planSend({ hasPhone: true, optedOut: false, windowOpen: false, hasApprovedTemplate: false })).toEqual({
      action: "skip",
      reason: "needs_template",
    });
  });
  test("sin número o dada de baja: nunca", () => {
    expect(planSend({ hasPhone: false, optedOut: false, windowOpen: true, hasApprovedTemplate: true }).action).toBe("skip");
    expect(planSend({ hasPhone: true, optedOut: true, windowOpen: true, hasApprovedTemplate: true })).toEqual({
      action: "skip",
      reason: "opted_out",
    });
  });
});

describe("variables", () => {
  test("rellena y quita lo que falta", () => {
    expect(fillVars("Hola {{nombre}}, el {{evento}} es {{fecha}}.", { nombre: "Ana", evento: "taller" })).toBe(
      "Hola Ana, el taller es ."
    );
  });
  test("parámetros de plantilla en orden, con guion si faltan", () => {
    expect(templateParams(["nombre", "enlace"], { nombre: "Ana" })).toEqual(["Ana", "-"]);
  });
  test("primer nombre", () => {
    expect(firstName("  María José Pérez ")).toBe("María");
  });
});

describe("bajas", () => {
  test("detecta pedidos cortos de no escribir más", () => {
    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("No me escribas más!")).toBe(true);
    expect(isOptOutMessage("no más mensajes")).toBe(true);
  });
  test("no confunde una frase larga", () => {
    expect(isOptOutMessage("no más tristeza en mi vida, quiero sanar")).toBe(false);
    expect(isOptOutMessage("Hola")).toBe(false);
  });
});

describe("resumen", () => {
  test("cuenta y estima costo solo de plantillas", () => {
    const s = summarizePlans(
      [
        { action: "text" },
        { action: "template" },
        { action: "template" },
        { action: "skip", reason: "no_phone" },
      ],
      0.05
    );
    expect(s).toMatchObject({ total: 4, text: 1, template: 2, estimatedCost: 0.1 });
    expect(s.skipped.no_phone).toBe(1);
  });
});

describe("approval delivery", () => {
  test("never blocks: without template it goes from the phone", () => {
    expect(approvalDelivery({ windowOpen: true, hasApprovedTemplate: false })).toBe("text");
    expect(approvalDelivery({ windowOpen: false, hasApprovedTemplate: true })).toBe("template");
    expect(approvalDelivery({ windowOpen: false, hasApprovedTemplate: false })).toBe("phone");
  });
  test("window state and notice", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    expect(windowStateOf(null, now)).toBe("never");
    expect(windowStateOf(new Date(now - 3600_000), now)).toBe("open");
    expect(windowStateOf(new Date(now - 30 * 3600_000), now)).toBe("closed");
    expect(windowNotice("open")).toBeNull();
    expect(windowNotice("never")).toContain("todavía no te ha escrito");
    expect(windowNotice("closed")).toContain("24 h");
  });
});

import { deliveryLabel } from "./whatsapp-delivery-labels";

describe("deliveryLabel: la misma frase en todo el CRM", () => {
  test("cada estado de WhatsApp tiene una sola frase", () => {
    expect(deliveryLabel("SENT").label).toBe("Enviado, aún no le llega");
    expect(deliveryLabel("DELIVERED").label).toBe("Le llegó");
    expect(deliveryLabel("READ").label).toBe("Lo leyó");
    expect(deliveryLabel("FAILED", "Message undeliverable").label).toBe(
      "No le llegó: WhatsApp no pudo entregarlo a esa persona"
    );
    expect(deliveryLabel("FAILED").tone).toBe("fail");
  });
});

describe("headerImageProblem", () => {
  const T = "masterclass_gratuita_20261004";
  test("sin imagen y sin cabecera IMAGE: se puede (como antes)", () => {
    expect(headerImageProblem({ hasImage: false, templateTitle: null, headerFormat: null })).toBeNull();
    expect(headerImageProblem({ hasImage: false, templateTitle: T, headerFormat: null })).toBeNull();
    expect(headerImageProblem({ hasImage: false, templateTitle: T, headerFormat: "TEXT" })).toBeNull();
    // No se pudo mirar 360dialog: un envío sin imagen no se bloquea por eso.
    expect(headerImageProblem({ hasImage: false, templateTitle: T, headerFormat: undefined })).toBeNull();
  });
  test("plantilla con imagen sin imagen: bloqueado", () => {
    expect(headerImageProblem({ hasImage: false, templateTitle: T, headerFormat: "IMAGE" })).toContain("adjunta la imagen");
  });
  test("imagen con plantilla con cabecera IMAGE: se puede", () => {
    expect(headerImageProblem({ hasImage: true, templateTitle: T, headerFormat: "IMAGE" })).toBeNull();
  });
  test("imagen sin plantilla, con plantilla sin imagen o sin poder comprobar: bloqueado", () => {
    expect(headerImageProblem({ hasImage: true, templateTitle: null, headerFormat: null })).toContain("plantilla aprobada");
    expect(headerImageProblem({ hasImage: true, templateTitle: T, headerFormat: null })).toContain("no lleva imagen");
    expect(headerImageProblem({ hasImage: true, templateTitle: T, headerFormat: "TEXT" })).toContain("no lleva imagen");
    expect(headerImageProblem({ hasImage: true, templateTitle: T, headerFormat: undefined })).toContain("No pude comprobar");
  });
});

describe("splitImageCaption", () => {
  test("cabe en el pie: un solo mensaje con la imagen y el texto", () => {
    expect(splitImageCaption("Hola Ana")).toEqual({ caption: "Hola Ana", separateText: null });
    const exact = "a".repeat(IMAGE_CAPTION_MAX);
    expect(splitImageCaption(exact)).toEqual({ caption: exact, separateText: null });
  });

  test("no cabe: la imagen sin pie y el texto aparte, entero", () => {
    const long = "a".repeat(IMAGE_CAPTION_MAX + 1);
    expect(splitImageCaption(long)).toEqual({ caption: "", separateText: long });
  });

  test("se mide el texto ya con el nombre puesto", () => {
    const text = `Hola {{nombre}}, ${"a".repeat(IMAGE_CAPTION_MAX - 10)}`;
    expect(splitImageCaption(fillVars(text, { nombre: "" })).separateText).toBeNull();
    expect(splitImageCaption(fillVars(text, { nombre: "Maximiliana" })).separateText).not.toBeNull();
  });
});

describe("splitSendVars", () => {
  test("la imagen y su copia salen de las variables del mensaje", () => {
    const out = splitSendVars({
      evento: "«Taller»",
      [HEADER_IMAGE_VAR]: "media-1",
      [HEADER_IMAGE_URL_VAR]: "https://x.private.blob.vercel-storage.com/inbox/outbound/a.png",
      [HEADER_IMAGE_MIME_VAR]: "image/png",
      __otra: "no va al texto",
    });
    expect(out.vars).toEqual({ evento: "«Taller»" });
    expect(out.headerImage).toEqual({
      id: "media-1",
      copy: { url: "https://x.private.blob.vercel-storage.com/inbox/outbound/a.png", mimeType: "image/png" },
    });
  });

  test("envío viejo sin copia, o sin imagen", () => {
    expect(splitSendVars({ [HEADER_IMAGE_VAR]: "media-1" }).headerImage).toEqual({ id: "media-1", copy: null });
    expect(splitSendVars({ evento: "x" })).toEqual({ vars: { evento: "x" }, headerImage: null });
    expect(splitSendVars(null)).toEqual({ vars: {}, headerImage: null });
  });
});
