import { describe, expect, test } from "bun:test";

import { approvalStatus, isApprovalPart, isQuestionPart, type ToolPartLike } from "./approval";
import {
  activitySummary,
  buildActivity,
  findPendingCallId,
  formatDuration,
  latestPlan,
  specialistReport,
  stepDoneLabel,
  stepRunningLabel,
  toGerund,
  turnTimings,
} from "./steps";

const GATE = {
  display: "confirmation",
  options: [{ id: "approve" }, { id: "deny" }],
  prompt: "Approve tool call: send_whatsapp_to_contact",
  requestId: "req_1",
};

const tool = (toolName: string, state: ToolPartLike["state"], extra: Partial<ToolPartLike> = {}): ToolPartLike => ({
  type: "dynamic-tool",
  toolName,
  toolCallId: `${toolName}-${state}`,
  state,
  input: {},
  ...extra,
});

describe("labels", () => {
  test("infinitive → gerund", () => {
    expect(toGerund("Buscar contactos")).toBe("Buscando contactos");
    expect(toGerund("Ver contacto")).toBe("Viendo contacto");
    expect(toGerund("Leer conversación")).toBe("Leyendo conversación");
    expect(toGerund("Mover evento")).toBe("Moviendo evento");
    expect(toGerund("Subir a Drive")).toBe("Subiendo a Drive");
    expect(toGerund("Pedir código de pago")).toBe("Pidiendo código de pago");
    expect(toGerund("Pagos")).toBeNull();
    expect(toGerund("Historial de cambios")).toBeNull();
  });

  test("running labels use the catalog; nouns get «Revisando»", () => {
    expect(stepRunningLabel("search_contacts")).toBe("Buscando contactos");
    expect(stepRunningLabel("list_payments")).toBe("Revisando pagos");
    expect(stepRunningLabel("whatsapp_ai_status")).toBe("Revisando estado de la IA de WhatsApp");
    expect(stepRunningLabel("memory")).toBe("Revisando la memoria");
    expect(stepRunningLabel("some_new_tool")).toBe("Revisando some new tool");
  });

  test("done labels", () => {
    expect(stepDoneLabel("search_contacts")).toBe("Buscar contactos");
    expect(stepDoneLabel("weird_tool")).toBe("Weird tool");
  });
});

describe("buildActivity", () => {
  test("running step drives the shimmer label; todo and ask_question are not steps", () => {
    const activity = buildActivity([
      { type: "step-start" },
      tool("todo", "output-available"),
      tool("search_contacts", "output-available"),
      tool("list_payments", "input-available"),
      tool("ask_question", "approval-requested", { toolMetadata: { eve: { inputRequest: { prompt: "¿Cuál?" } } } }),
      { type: "text" },
    ]);
    expect(activity.steps.map((s) => s.name)).toEqual(["search_contacts", "list_payments"]);
    expect(activity.running).toBe(true);
    expect(activity.currentLabel).toBe("Revisando pagos…");
  });

  test("finished activity: no current label, errors counted", () => {
    const activity = buildActivity([tool("search_contacts", "output-available"), tool("get_contact", "output-error", { errorText: "x" })]);
    expect(activity.running).toBe(false);
    expect(activity.currentLabel).toBeNull();
    expect(activity.errorCount).toBe(1);
    expect(activity.steps[1].status).toBe("error");
  });

  test("specialist delegation is one step with its own wording", () => {
    const running = buildActivity([tool("ventas", "input-available", { input: { message: "ventas del mes" } })]);
    expect(running.currentLabel).toBe("Ventas está trabajando…");
    expect(running.steps[0].kind).toBe("specialist");

    const done = buildActivity([tool("talleres", "output-available", { output: "Hay 12 inscritas." })]);
    expect(done.steps[0].label).toBe("Talleres y eventos trabajó en esto");
  });

  test("the live approval reads as waiting; a stale one doesn't", () => {
    const part = tool("send_whatsapp_to_contact", "approval-requested", {
      approval: { isAutomatic: false },
      toolMetadata: { eve: { inputRequest: GATE } },
    });
    const live = buildActivity([part], part.toolCallId);
    expect(live.steps[0].status).toBe("waiting");
    expect(live.currentLabel).toBe("Esperando tu aprobación");
    const stale = buildActivity([part], null);
    expect(stale.steps[0].status).toBe("denied");
    expect(stale.running).toBe(false);
  });

  test("findPendingCallId only looks at the last part of the last message", () => {
    const pending = tool("send_contact_sms", "approval-requested");
    expect(findPendingCallId([{ parts: [pending] }, { parts: [tool("x", "output-available")] }])).toBeNull();
    expect(findPendingCallId([{ parts: [tool("x", "output-available"), pending] }])).toBe(pending.toolCallId);
    expect(findPendingCallId([])).toBeNull();
  });
});

describe("approvals", () => {
  const gate = (state: ToolPartLike["state"], extra: Partial<ToolPartLike> = {}) =>
    tool("send_whatsapp_to_contact", state, { toolMetadata: { eve: { inputRequest: GATE } }, ...extra });

  test("gate vs question", () => {
    expect(isApprovalPart(gate("approval-requested"))).toBe(true);
    expect(isQuestionPart(gate("approval-requested"))).toBe(false);
    const question = tool("ask_question", "approval-requested", { toolMetadata: { eve: { inputRequest: { prompt: "¿Cuál?" } } } });
    expect(isApprovalPart(question)).toBe(false);
    expect(isQuestionPart(question)).toBe(true);
    // Metadata gone after the result, but the approval record stays.
    expect(isApprovalPart(tool("send_contact_sms", "output-available", { approval: { approved: true } }))).toBe(true);
    expect(isApprovalPart(tool("search_contacts", "output-available", { approval: { approved: true, isAutomatic: true } }))).toBe(false);
  });

  test("status", () => {
    expect(approvalStatus(gate("approval-requested"), true)).toBe("pending");
    expect(approvalStatus(gate("approval-requested"), false)).toBe("unanswered");
    expect(approvalStatus(gate("output-available", { approval: { approved: true } }), false)).toBe("approved");
    expect(approvalStatus(gate("output-denied", { approval: { approved: false } }), false)).toBe("denied");
    expect(
      approvalStatus(gate("approval-responded", { toolMetadata: { eve: { inputRequest: GATE, inputResponse: { optionId: "deny" } } } }), false)
    ).toBe("denied");
  });
});

describe("plan and reports", () => {
  test("latest todo wins, output over input", () => {
    const plan = latestPlan([
      tool("todo", "output-available", { output: { todos: [{ content: "A", status: "pending", priority: "high" }] } }),
      tool("todo", "output-available", {
        input: { todos: [] },
        output: {
          todos: [
            { content: "A", status: "completed", priority: "high" },
            { content: "B", status: "in_progress", priority: "low" },
            { content: 3, status: "pending" },
          ],
        },
      }),
    ]);
    expect(plan).toEqual([
      { content: "A", status: "completed" },
      { content: "B", status: "in_progress" },
    ]);
    expect(latestPlan([tool("search_contacts", "output-available")])).toBeNull();
  });

  test("specialist report from string or object", () => {
    expect(specialistReport("  Listo.  ")).toBe("Listo.");
    expect(specialistReport({ report: "Hay 3." })).toBe("Hay 3.");
    expect(specialistReport({ output: { text: "Anidado" } })).toBe("Anidado");
    expect(specialistReport({ count: 3 })).toBeNull();
  });
});

describe("timing", () => {
  const at = (s: number) => ({ at: new Date(Date.UTC(2026, 10, 7, 12, 0, s)).toISOString() });

  test("turn duration excludes the wait for approval; reasoning summed per step", () => {
    const timings = turnTimings([
      { type: "turn.started", data: { turnId: "t1" }, meta: at(0) },
      { type: "reasoning.appended", data: { turnId: "t1", stepIndex: 0 }, meta: at(1) },
      { type: "reasoning.completed", data: { turnId: "t1", stepIndex: 0 }, meta: at(4) },
      { type: "input.requested", data: { turnId: "t1" }, meta: at(5) },
      { type: "action.result", data: { turnId: "t1" }, meta: at(35) },
      { type: "turn.completed", data: { turnId: "t1" }, meta: at(37) },
      { type: "session.waiting", data: {}, meta: at(38) },
      { type: "turn.started", data: { turnId: "t2" } },
    ]);
    expect(timings.get("t1")).toEqual({ totalMs: 7000, reasoningMs: 3000 });
    expect(timings.has("t2")).toBe(false);
  });

  test("formatting", () => {
    expect(formatDuration(200)).toBe("1 s");
    expect(formatDuration(12_400)).toBe("12 s");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatDuration(120_000)).toBe("2 min");
    expect(activitySummary(1)).toBe("1 paso");
    expect(activitySummary(3, 12_000)).toBe("3 pasos · 12 s");
    expect(activitySummary(2, 0)).toBe("2 pasos");
  });
});
