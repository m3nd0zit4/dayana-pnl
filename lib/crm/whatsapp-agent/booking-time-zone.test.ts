import { describe, expect, test } from "bun:test";

import { inferPersonZone } from "./booking-time";

const said = (...bodies: string[]) => bodies.map((body) => ({ direction: "INBOUND" as const, body }));

describe("inferPersonZone (la zona cuando la IA no la guardó)", () => {
  test("Sophie: «Desde colombia» → Bogotá", () => {
    expect(inferPersonZone("573104673159", said("La verdad no muy bien", "Desde colombia"))).toMatchObject({ iso: "CO", timezone: "America/Bogota" });
  });

  test("«💙💙💜🩷»: «De la CDMX» → Ciudad de México", () => {
    expect(inferPersonZone("5215638169172", said("De la CDMX"))).toMatchObject({ iso: "MX", timezone: "America/Mexico_City" });
  });

  test("sin decirlo: un número de un país con una sola zona alcanza", () => {
    expect(inferPersonZone("573104673159", said("Hola"))).toMatchObject({ iso: "CO", timezone: "America/Bogota" });
    expect(inferPersonZone("51905627097", said("Hola"))?.iso).toBe("PE");
  });

  test("el país que dice gana al del número", () => {
    expect(inferPersonZone("573104673159", said("Vivo en España"))).toMatchObject({ iso: "ES" });
  });

  test("México o Estados Unidos sin ciudad: no se adivina", () => {
    expect(inferPersonZone("5215638169172", said("Hola"))).toBeNull();
    expect(inferPersonZone("573104673159", said("Estoy en México"))).toBeNull();
  });

  test("lo que escribió la asistente no cuenta (solo lo que dijo la persona)", () => {
    expect(inferPersonZone("5215638169172", [{ direction: "OUTBOUND", body: "¿Estás en CDMX?" }])).toBeNull();
  });
});
