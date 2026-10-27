import { describe, expect, test } from "bun:test";

import {
  CAPI_TOKEN_INPUT_MESSAGES,
  checkCapiToken,
  parseCapiTokenInput,
} from "./capi-token-input";

const TOKEN = `EAAB${"x1Y2".repeat(40)}`;

describe("parseCapiTokenInput", () => {
  test("acepta un token normal y lo devuelve igual", () => {
    expect(parseCapiTokenInput(TOKEN)).toEqual({ ok: true, token: TOKEN });
  });

  test("quita espacios, comillas y «Bearer » que arrastra el portapapeles", () => {
    for (const pasted of [
      `  ${TOKEN}\n`,
      `"${TOKEN}"`,
      `'${TOKEN}'`,
      `\`${TOKEN}\``,
      `Bearer ${TOKEN}`,
      `bearer ${TOKEN}`,
      `"Bearer ${TOKEN}"`,
    ]) {
      expect(parseCapiTokenInput(pasted)).toEqual({ ok: true, token: TOKEN });
    }
  });

  test("vacío o solo espacios", () => {
    for (const pasted of ["", "   ", "\n", '""', "Bearer "]) {
      expect(parseCapiTokenInput(pasted)).toEqual({ ok: false, issue: "empty" });
    }
  });

  test("dos cosas pegadas juntas o varias líneas", () => {
    expect(parseCapiTokenInput(`${TOKEN}\n${TOKEN}`)).toEqual({
      ok: false,
      issue: "spaces",
    });
    expect(parseCapiTokenInput(`access_token ${TOKEN}`)).toEqual({
      ok: false,
      issue: "spaces",
    });
  });

  test("demasiado corto y demasiado largo", () => {
    expect(parseCapiTokenInput("EAAB123")).toEqual({ ok: false, issue: "too_short" });
    expect(parseCapiTokenInput("a".repeat(601))).toEqual({
      ok: false,
      issue: "too_long",
    });
    expect(parseCapiTokenInput("a".repeat(600))).toEqual({
      ok: true,
      token: "a".repeat(600),
    });
  });

  test("caracteres que un token no tiene (puntos suspensivos, viñetas, símbolos)", () => {
    expect(parseCapiTokenInput(`${TOKEN.slice(0, 60)}…`)).toEqual({
      ok: false,
      issue: "characters",
    });
    expect(parseCapiTokenInput(`${"•".repeat(50)}`)).toEqual({
      ok: false,
      issue: "characters",
    });
    expect(parseCapiTokenInput(`${TOKEN}&x=1`)).toEqual({
      ok: false,
      issue: "characters",
    });
  });

  test("no exige el prefijo EAA: Meta ya cambió de formato antes", () => {
    const other = "a".repeat(80);
    expect(parseCapiTokenInput(other)).toEqual({ ok: true, token: other });
  });

  test("cada motivo de rechazo tiene su mensaje y ninguno repite el token", () => {
    const attempt = parseCapiTokenInput(`${TOKEN}\n${TOKEN}`);
    expect(attempt.ok).toBe(false);
    for (const message of Object.values(CAPI_TOKEN_INPUT_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain("EAAB");
    }
  });
});

const reply = (status: number, body: unknown) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

describe("checkCapiToken", () => {
  test("Meta contesta 200: el token vale", async () => {
    expect(await checkCapiToken(TOKEN, reply(200, { id: "1" }))).toEqual({
      state: "valid",
    });
  });

  test("código 190 (aunque el estado sea 400): token rechazado", async () => {
    const check = await checkCapiToken(
      TOKEN,
      reply(400, { error: { code: 190, message: "Invalid OAuth access token" } })
    );
    expect(check.state).toBe("invalid");
  });

  test("estado 401 sin cuerpo útil: token rechazado", async () => {
    expect((await checkCapiToken(TOKEN, reply(401, "")) ).state).toBe("invalid");
  });

  test("otro error de Meta no se toma por token malo", async () => {
    const check = await checkCapiToken(
      TOKEN,
      reply(400, { error: { code: 100, message: "Unsupported get request" } })
    );
    expect(check.state).toBe("unknown");
    if (check.state === "unknown") expect(check.message).toContain("Unsupported get request");
  });

  test("Meta caído (500) y respuesta que no es JSON: no se sabe", async () => {
    expect((await checkCapiToken(TOKEN, reply(500, "<html>"))).state).toBe("unknown");
    expect((await checkCapiToken(TOKEN, reply(503, ""))).state).toBe("unknown");
  });

  test("sin red: no se sabe, no se rechaza", async () => {
    const check = await checkCapiToken(TOKEN, async () => {
      throw new Error("fetch failed");
    });
    expect(check.state).toBe("unknown");
  });

  test("el token viaja en la cabecera, nunca en la URL, y es de solo lectura", async () => {
    let url = "";
    let headers: Record<string, string> | undefined;
    await checkCapiToken(TOKEN, async (input, init) => {
      url = input;
      headers = init?.headers;
      return { ok: true, status: 200, text: async () => "{}" };
    });
    expect(url).not.toContain(TOKEN);
    expect(url).not.toContain("access_token");
    expect(headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).toContain("/me");
  });

  test("ningún mensaje devuelto repite el token, ni cuando el error de Meta lo trae", async () => {
    for (const code of [190, 100]) {
      const check = await checkCapiToken(
        TOKEN,
        reply(400, { error: { code, message: `bad ${TOKEN}` } })
      );
      expect(JSON.stringify(check)).not.toContain(TOKEN);
    }
  });
});
