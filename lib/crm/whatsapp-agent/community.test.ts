import { describe, expect, test } from "bun:test";

import { asksToJoinCommunity } from "./community";

describe("asksToJoinCommunity", () => {
  test.each([
    "Quise ingresar al link  de Comunidad y no pude", // Ruth, 23-oct
    "Buenas noches sra Dayana, por favor me podría agregar al grupo de su  comunidad...",
    "¿Cómo me uno a la comunidad?",
    "Me pasas el enlace del grupo",
  ])("pide entrar: %s", (text) => {
    expect(asksToJoinCommunity([text])).toBe(true);
  });

  test.each(["Gracias, me encanta la comunidad", "¿El grupo es solo para mujeres?", "Quiero el link de pago"])("no: %s", (text) => {
    expect(asksToJoinCommunity([text])).toBe(false);
  });
});
