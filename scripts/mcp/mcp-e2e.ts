/**
 * Servidor MCP de punta a punta, contra la base de DESARROLLO, llamando al
 * handler de `/api/mcp` dentro del proceso (sin servidor HTTP).
 *
 *   bun --env-file=../dayana-pnl/.env scripts/mcp/mcp-e2e.ts
 *
 * Crea tokens para el OWNER de dev (y para una persona READONLY si la hay; si
 * no, simula el READONLY con un token de solo lectura), comprueba initialize,
 * tools/list por scope, llamadas de lectura, que una de edición deja su fila
 * MCP_TOOL_CALL, que READONLY no ve ni puede llamar edición, y que un token
 * revocado, caducado o ausente da 401. Borra sus tokens al terminar.
 *
 * NUNCA llama herramientas de envío (WhatsApp/correo/SMS/masivos): la base de
 * dev tiene una clave real de WhatsApp.
 */
import { TOOL_CATALOG, type ToolName } from "@/lib/crm-tools/catalog";

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname;
  } catch {
    return "";
  }
})();
if (dbName !== "/neondb_dev") {
  console.error("Solo contra neondb_dev. DATABASE_URL apunta a otra base: no hago nada.");
  process.exit(1);
}

const { prisma } = await import("@/lib/db");
const { createMcpToken } = await import("@/lib/mcp/tokens");
const { visibleTools } = await import("@/lib/mcp/scopes");
const route = await import("@/app/api/mcp/route");

const PROTOCOL = "2025-06-18";
const created: string[] = [];
let failures = 0;
const results: string[] = [];

const check = (label: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

type RpcResponse = { status: number; body: { result?: Record<string, unknown>; error?: { message: string } } | null };

let rpcId = 0;
const rpc = async (token: string | null, method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const res = await route.POST(req);
  const text = await res.text();
  let body: RpcResponse["body"] = null;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((m) => m.id === rpcId);
    body = data ?? null;
  } else if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
};

const initialize = (token: string | null) =>
  rpc(token, "initialize", {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: "mcp-e2e", version: "1.0.0" },
  });

const listTools = async (token: string) => {
  const res = await rpc(token, "tools/list");
  const tools = (res.body?.result?.tools ?? []) as { name: string; annotations?: Record<string, unknown> }[];
  return { res, names: tools.map((t) => t.name), tools };
};

const call = async (token: string, name: string, args: Record<string, unknown>) => {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  const result = res.body?.result as
    | { isError?: boolean; content?: { text?: string }[]; structuredContent?: Record<string, unknown> }
    | undefined;
  return {
    status: res.status,
    rpcError: res.body?.error?.message ?? null,
    isError: Boolean(result?.isError),
    text: result?.content?.[0]?.text ?? "",
    structured: result?.structuredContent ?? null,
  };
};

const countByAccess = (names: string[]) =>
  names.reduce<Record<string, number>>((acc, n) => {
    const access = TOOL_CATALOG[n as ToolName]?.access ?? "unknown";
    acc[access] = (acc[access] ?? 0) + 1;
    return acc;
  }, {});

try {
  const owner = await prisma.staffUser.findFirst({
    where: { role: "OWNER", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, displayName: true },
  });
  if (!owner) throw new Error("No hay OWNER activo en neondb_dev.");
  const readonlyStaff = await prisma.staffUser.findFirst({
    where: { role: "READONLY", isActive: true },
    select: { id: true, role: true, displayName: true },
  });

  const mk = async (staff: { id: string; role: "OWNER" | "OPERATOR" | "READONLY" | "DEVELOPER" }, name: string, scopes: string[]) => {
    const { token, record } = await createMcpToken({ staff, name: `e2e ${name}`, scopes, expiresInDays: 30 });
    created.push(record.id);
    return { token, id: record.id };
  };

  const full = await mk(owner, "owner-full", ["read", "edit", "execute"]);
  const ownerEdit = await mk(owner, "owner-read-edit", ["read", "edit"]);
  const reader = readonlyStaff ? await mk(readonlyStaff, "readonly", ["read"]) : await mk(owner, "simulated-readonly", ["read"]);
  const revoked = await mk(owner, "revoked", ["read"]);
  const expired = await mk(owner, "expired", ["read"]);
  await prisma.mcpAccessToken.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
  await prisma.mcpAccessToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  results.push(`READONLY: ${readonlyStaff ? `real (${readonlyStaff.displayName})` : "simulado con un token de solo lectura del OWNER"}`);

  // ── auth ──────────────────────────────────────────────────────────────
  check("sin token → 401", (await initialize(null)).status === 401);
  check("token inventado → 401", (await initialize(`dpnl_${"x".repeat(43)}`)).status === 401);
  check("token revocado → 401", (await initialize(revoked.token)).status === 401);
  check("token caducado → 401", (await initialize(expired.token)).status === 401);

  // ── initialize ────────────────────────────────────────────────────────
  const init = await initialize(full.token);
  const serverInfo = init.body?.result?.serverInfo as { name?: string } | undefined;
  check("initialize", init.status === 200 && serverInfo?.name === "dayana-crm", `status ${init.status}`);
  check("initialize trae instrucciones", typeof init.body?.result?.instructions === "string");

  // ── tools/list por scope ──────────────────────────────────────────────
  const all = await listTools(full.token);
  const oe = await listTools(ownerEdit.token);
  const ro = await listTools(reader.token);
  const expected = {
    full: visibleTools(["read", "edit", "execute"]).length,
    oe: visibleTools(["read", "edit"]).length,
    ro: visibleTools(["read"]).length,
  };
  results.push(`tools/list OWNER read+edit+execute: ${all.names.length} ${JSON.stringify(countByAccess(all.names))}`);
  results.push(`tools/list OWNER read+edit: ${oe.names.length} ${JSON.stringify(countByAccess(oe.names))}`);
  results.push(`tools/list READONLY: ${ro.names.length} ${JSON.stringify(countByAccess(ro.names))}`);
  check("tools/list completo", all.names.length === expected.full, `${all.names.length}/${expected.full}`);
  check("tools/list read+edit", oe.names.length === expected.oe && !oe.names.includes("send_whatsapp_to_contact"));
  check(
    "tools/list READONLY solo lecturas",
    ro.names.length === expected.ro && ro.names.every((n) => TOOL_CATALOG[n as ToolName]?.access === "read")
  );
  const send = all.tools.find((t) => t.name === "send_whatsapp_to_contact");
  const stats = all.tools.find((t) => t.name === "crm_stats");
  check(
    "annotations",
    send?.annotations?.destructiveHint === true && stats?.annotations?.readOnlyHint === true,
    JSON.stringify({ send: send?.annotations, stats: stats?.annotations })
  );

  // ── llamadas de lectura ───────────────────────────────────────────────
  const readCalls: [string, Record<string, unknown>][] = [["crm_stats", { area: "ventas" }]];
  const someContact = await prisma.contact.findFirst({ select: { firstName: true }, orderBy: { createdAt: "desc" } });
  readCalls.push(["search_contacts", { q: someContact?.firstName?.slice(0, 4) || "a", limit: 3 }]);

  const edition = await prisma.workshopEdition.findFirst({ orderBy: { createdAt: "desc" }, select: { slug: true } });
  if (edition) readCalls.push(["list_workshop_enrollees", { slug: edition.slug, limit: 5 }]);
  readCalls.push(["list_free_event_registrations", { pageSize: 10 }]);
  const conversation = await prisma.conversationMessage.findFirst({
    orderBy: { sentAt: "desc" },
    select: { conversationId: true },
  });
  if (conversation) readCalls.push(["list_whatsapp_messages", { conversationId: conversation.conversationId, limit: 5 }]);
  readCalls.push(["list_payment_receipts", { days: 60, limit: 5 }]);
  readCalls.push(["list_ai_runs", { hours: 72, limit: 5 }]);
  readCalls.push(["list_appointments", { limit: 5 }]);
  readCalls.push(["list_notifications", {}]);
  const payment = await prisma.payment.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
  if (payment) readCalls.push(["get_payment", { paymentId: payment.id }]);

  for (const [name, args] of readCalls) {
    const r = await call(full.token, name, args);
    const ok = r.status === 200 && !r.rpcError && !r.isError && r.structured !== null && !("display" in (r.structured ?? {}));
    check(`call ${name}`, ok, ok ? `${r.text.length} chars` : (r.rpcError ?? r.text.slice(0, 200)));
  }
  const viaReader = await call(reader.token, "crm_stats", { area: "ventas" });
  check("READONLY puede leer (crm_stats)", !viaReader.isError && !viaReader.rpcError);

  // ── entrada inválida → error, no excepción ────────────────────────────
  const bad = await call(full.token, "crm_stats", { area: "nada" });
  check("entrada inválida → error", bad.isError || Boolean(bad.rpcError), bad.rpcError ?? bad.text.slice(0, 120));

  // ── edición: deja MCP_TOOL_CALL ───────────────────────────────────────
  const since = new Date();
  // Ids inventados: el enlace falla, pero la llamada de edición queda auditada.
  const link = await call(ownerEdit.token, "link_conversation_to_contact", { conversationId: "e2e-none", contactId: "e2e-none" });
  check("call link_conversation_to_contact (edit) responde", Boolean(link.text) || Boolean(link.rpcError) || link.isError);
  const audit = await prisma.auditLog.findFirst({
    where: { action: "MCP_TOOL_CALL", entityId: "link_conversation_to_contact", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const changes = (audit?.changes ?? {}) as { tokenId?: string; ok?: boolean };
  check("fila MCP_TOOL_CALL", Boolean(audit) && changes.tokenId === ownerEdit.id);

  // ── las herramientas del asistente del panel (quitado) ya no existen ──
  for (const gone of ["memory", "message_owner"]) {
    check(`${gone} no está en MCP (ni con todos los permisos)`, !all.names.includes(gone));
    const r = await call(full.token, gone, {});
    check(`${gone} no se puede llamar por MCP`, r.isError || Boolean(r.rpcError), r.rpcError ?? r.text.slice(0, 120));
  }

  // ── READONLY no puede edición ─────────────────────────────────────────
  // Ids inventados: aunque se colara, no cambiaría nada.
  const roLink = await call(reader.token, "link_conversation_to_contact", { conversationId: "e2e-none", contactId: "e2e-none" });
  check("READONLY no puede llamar link_conversation_to_contact", roLink.isError || Boolean(roLink.rpcError));
  // record_manual_payment solo comprueba un código: nunca manda correo.
  check("read+edit no ve execute", !oe.names.includes("record_manual_payment") && !oe.names.includes("request_payment_otp"));
  const oeExec = await call(ownerEdit.token, "record_manual_payment", {
    enrollmentId: "e2e-none",
    amountMinor: 100,
    currency: "USD",
    code: "000000",
  });
  check("read+edit no puede llamar execute (record_manual_payment)", oeExec.isError || Boolean(oeExec.rpcError));

  // ── lastUsedAt ────────────────────────────────────────────────────────
  const touched = await prisma.mcpAccessToken.findUnique({ where: { id: full.id }, select: { lastUsedAt: true } });
  check("lastUsedAt", Boolean(touched?.lastUsedAt));

  // ── revocar en caliente ───────────────────────────────────────────────
  await prisma.mcpAccessToken.update({ where: { id: reader.id }, data: { revokedAt: new Date() } });
  check("revocado en caliente → 401", (await rpc(reader.token, "tools/list")).status === 401);
} catch (error) {
  failures++;
  results.push(`FAIL  excepción: ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (created.length) await prisma.mcpAccessToken.deleteMany({ where: { id: { in: created } } });
  results.push(`tokens de prueba borrados: ${created.length}`);
}

console.log(results.join("\n"));
console.log(failures ? `\n${failures} FALLO(S)` : "\nTODO OK");
process.exit(failures ? 1 : 0);
