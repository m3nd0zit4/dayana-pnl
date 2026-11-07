import { describe, expect, test } from "bun:test";
import { gradeTurn, isApprovalGate, type RecordedTurn } from "./graders";

const turn = (over: Partial<RecordedTurn> = {}): RecordedTurn => ({
  say: "x",
  texts: [],
  tools: [],
  requests: [],
  status: "waiting",
  reply: "Listo.",
  ms: 1,
  ...over,
});

describe("gradeTurn", () => {
  test("passes a clean stats answer", () => {
    const t = turn({ tools: [{ name: "crm_stats", input: {} }], reply: "Vendiste 570.000 COP y 49 USD." });
    expect(gradeTurn(t, { anyTool: ["crm_stats"] })).toEqual([]);
  });

  test("flags the double approval: «¿confirmas?» before the card", () => {
    const t = turn({
      texts: ["¿Confirmas crear el código EVAL10?"],
      tools: [{ name: "create_promo_code", input: {} }],
      requests: [{ kind: "approval", tool: "create_promo_code", options: ["approve", "deny"], afterText: 0 }],
    });
    expect(gradeTurn(t, { approvals: 1 }).map((f) => f.check)).toContain("doubleApproval");
  });

  test("flags a Sí/No question before an approval", () => {
    const t = turn({
      requests: [
        { kind: "question", prompt: "¿Lo creo?", options: ["Sí", "No"], afterText: -1 },
        { kind: "approval", tool: "create_contact", options: ["approve", "deny"], afterText: -1 },
      ],
    });
    const checks = gradeTurn(t, { approvals: 1 }).map((f) => f.check);
    expect(checks).toContain("question");
    expect(checks).toContain("doubleApproval");
  });

  test("one short line of intent before the card is fine", () => {
    const t = turn({
      texts: ["Creo el contacto de Ana con su teléfono."],
      requests: [{ kind: "approval", tool: "create_contact", options: ["approve", "deny"], afterText: 0 }],
    });
    expect(gradeTurn(t, { approvals: 1 })).toEqual([]);
  });

  test("counts approvals and missing tools", () => {
    const t = turn({ tools: [{ name: "search_contacts", input: {} }] });
    const checks = gradeTurn(t, { allTools: ["get_contact"], approvals: 1 }).map((f) => f.check);
    expect(checks).toEqual(["allTools", "approvals"]);
  });

  test("never pastes raw ids", () => {
    const t = turn({ reply: "La inscripción cmw6j3gue0000i5mgevkokiju está activa." });
    expect(gradeTurn(t, {}).map((f) => f.check)).toEqual(["rawId"]);
  });
});

test("isApprovalGate", () => {
  expect(isApprovalGate(["approve", "deny"])).toBe(true);
  expect(isApprovalGate(["yes", "no"])).toBe(false);
});
