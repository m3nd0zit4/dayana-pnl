import { describe, expect, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

import { apiError, readJson, withResolver } from "./handler-core";

const req = (body?: string) =>
  new NextRequest("http://localhost/api/admin/x", {
    method: "POST",
    ...(body !== undefined ? { body, headers: { "content-type": "application/json" } } : {}),
  });

describe("apiError", () => {
  test("cuerpo { error } con el status", async () => {
    const res = apiError("not_found", 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("conserva campos extra y el código no se puede pisar", async () => {
    const res = apiError("not_publishable", 400, { blockers: ["fecha"], error: "otro" });
    expect(await res.json()).toEqual({ blockers: ["fecha"], error: "not_publishable" });
  });

  test("error es la primera clave del JSON, como en los cuerpos a mano", async () => {
    const res = apiError("weak_password", 400, { message: "Muy corta" });
    expect(await res.text()).toBe('{"error":"weak_password","message":"Muy corta"}');
  });
});

describe("readJson", () => {
  test("devuelve el objeto", async () => {
    expect(await readJson(req('{"a":1}'))).toEqual({ a: 1 });
  });

  test("null si el cuerpo no es JSON o no hay cuerpo", async () => {
    expect(await readJson(req("no json"))).toBeNull();
    expect(await readJson(req())).toBeNull();
  });
});

describe("withResolver", () => {
  test("devuelve el rechazo del resolver sin llamar al handler", async () => {
    let called = false;
    const route = withResolver(
      async () => NextResponse.json({ error: "read_only" }, { status: 403 }),
      async () => {
        called = true;
        return NextResponse.json({ ok: true });
      }
    );
    const res = await route(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "read_only" });
    expect(called).toBe(false);
  });

  test("pasa staff y params resueltos al handler", async () => {
    const route = withResolver<{ id: string }, { id: string }>(
      async () => ({ id: "staff-1" }),
      async ({ staff, params }) => NextResponse.json({ staff: staff.id, id: params.id })
    );
    const res = await route(req(), { params: Promise.resolve({ id: "c1" }) });
    expect(await res.json()).toEqual({ staff: "staff-1", id: "c1" });
  });

  test("sin contexto de params entrega un objeto vacío", async () => {
    const route = withResolver<{ id: string }, Record<string, never>>(
      async () => ({ id: "s" }),
      async ({ params }) => NextResponse.json({ params })
    );
    const res = await route(req(), undefined as unknown as { params: Promise<Record<string, never>> });
    expect(await res.json()).toEqual({ params: {} });
  });
});
