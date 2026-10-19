import { describe, expect, test } from "bun:test";

import { inferPersonZone, trustedContactTimezone } from "./booking-time";

describe("trustedContactTimezone (Valerya, 17-oct: México con la zona por defecto de Colombia)", () => {
  test("la zona por defecto no vale para alguien de otro país", () => {
    expect(trustedContactTimezone({ timezone: "America/Bogota", countryIso: "MX", phoneCountryIso: "MX" })).toBeNull();
    expect(trustedContactTimezone({ timezone: "America/Bogota", countryIso: null, phoneCountryIso: "EC" })).toBeNull();
  });
  test("vale si es de Colombia, si no se sabe el país o si la zona no es la de por defecto", () => {
    expect(trustedContactTimezone({ timezone: "America/Bogota", countryIso: "CO" })).toBe("America/Bogota");
    expect(trustedContactTimezone({ timezone: "America/Bogota" })).toBe("America/Bogota");
    expect(trustedContactTimezone({ timezone: "America/Mexico_City", countryIso: "MX" })).toBe("America/Mexico_City");
    expect(trustedContactTimezone({ timezone: "No/Existe" })).toBeNull();
    expect(trustedContactTimezone(null)).toBeNull();
  });
});

const said = (...bodies: string[]) => bodies.map((body) => ({ direction: "INBOUND" as const, body }));

describe("inferPersonZone (la zona cuando la IA no la guardó)", () => {
  test("Raquel (19-oct): +34 y «España» → Madrid (las 7:00 p. m. que le ofreció la agenda eran de ahí)", () => {
    expect(inferPersonZone("34697103297", said("Hola guapa te vi por Tiktok", "España"))).toMatchObject({ iso: "ES", timezone: "Europe/Madrid" });
  });
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
