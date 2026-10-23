import { describe, expect, test } from "bun:test";

import { asksToJoinCommunity } from "./community";

describe("asksToJoinCommunity", () => {
  test.each([
    "Quise ingresar al link  de Comunidad y no pude", // Ruth, 23-oct
    "Buenas noches sra Dayana, por favor me podría agregar al grupo de su  comunidad...",
    "¿Cómo me uno a la comunidad?",
    "Me pasas el enlace del grupo de WhatsApp de Dayana",
  ])("pide entrar: %s", (text) => {
    expect(asksToJoinCommunity([text])).toBe(true);
  });

  test.each([
    "Gracias, me encanta la comunidad",
    "¿El grupo es solo para mujeres?",
    "Quiero el link de pago",
    // Revisión 23-oct: otro grupo, o algo que Dayana tiene que ver.
    "Me agregaron a un grupo y no quiero estar, ¿me sacan?",
    "Ya pagué el curso en vivo, ¿me agregan al grupo?",
    "¿El taller es en grupo? ¿Cómo entro?",
    "No puedo entrar al Meet, ¿lo mandan al grupo?",
    "¿Las grabaciones están en el grupo? No puedo entrar",
    "Me pasas el enlace del grupo",
  ])("no: %s", (text) => {
    expect(asksToJoinCommunity([text])).toBe(false);
  });
});
