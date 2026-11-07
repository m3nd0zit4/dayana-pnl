import crypto from "node:crypto";
import { McpServer, type AuthInfo, type CallToolResult, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { ToolContext } from "eve/tools";
import { createMcpHandler } from "mcp-handler";
import { TOOL_CATALOG, type ToolName } from "@/agent/lib/catalog";
import { toolDefinition } from "@/agent/lib/registry";
import { writeAuditLog } from "@/lib/crm/audit";
import { sanitizeToolInput } from "./audit-input";
import { canUseTool, visibleTools } from "./scopes";
import type { McpCaller } from "./tokens";

/**
 * El servidor MCP del CRM: las mismas herramientas que usan los agentes del
 * panel (`agent/lib/registry.ts`), filtradas por los scopes del que llama.
 *
 * Se construye por petición (sin estado, sin Redis): así `tools/list` enseña
 * solo lo que ESTE token puede usar, y lo que no puede ni aparece.
 */

export const MCP_SERVER_INFO = { name: "dayana-crm", version: "1.0.0" };

export const MCP_INSTRUCTIONS = [
  "CRM de Dayana Beltrán PNL (terapia, cursos, talleres y eventos gratuitos). Los datos y las respuestas están en español.",
  "Dinero: cada importe va en su moneda y en unidades menores (`amountMinor`): centavos en USD, pesos completos en COP. Nunca sumes monedas distintas.",
  "Para totales, comparaciones entre periodos y desgloses usa crm_stats (p. ej. {area: \"ventas\"}); list_payments es para ver pagos concretos.",
  "Busca a una persona con search_contacts y luego get_contact; los chats de WhatsApp con whatsapp_find_chat o list_conversations.",
  "Pago manual: primero request_payment_otp (manda un código al correo de Dayana) y luego record_manual_payment con el código que la dueña lee en su correo. Nunca inventes ni adivines el código.",
  "Las herramientas de ejecución (WhatsApp, correo, SMS, envíos masivos, precios, pagos) llegan a personas reales: confirma con quien te habla antes de usarlas.",
  "Todo lo que cambia datos queda en el registro de auditoría con el nombre de tu conexión.",
].join("\n");

/** Lo mismo que la tool le da al modelo del panel, sin `display` (solo sirve para dibujar). */
const toPlain = (output: unknown): unknown => {
  if (output && typeof output === "object" && !Array.isArray(output) && "display" in output) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { display, ...rest } = output as Record<string, unknown>;
    output = rest;
  }
  return output === undefined ? null : JSON.parse(JSON.stringify(output));
};

/** El contexto que esperan las tools de eve, con la identidad del token (ver `agent/lib/guard.ts`). */
const toolContext = (caller: McpCaller, name: string, signal?: AbortSignal): ToolContext => {
  const unavailable = () => {
    throw new Error("Esta herramienta necesita una conexión que no está disponible por MCP.");
  };
  return {
    session: {
      auth: {
        current: {
          principalId: caller.staffId,
          attributes: { role: caller.role, channel: "mcp", tokenId: caller.tokenId },
        },
      },
    },
    abortSignal: signal ?? new AbortController().signal,
    callId: `mcp_${crypto.randomUUID()}`,
    toolName: name,
    getToken: unavailable,
    requireAuth: unavailable,
  } as unknown as ToolContext;
};

const errorResult = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

/**
 * Ejecuta una herramienta del catálogo como `caller`. Devuelve siempre un
 * resultado MCP: los errores van como `isError` con el mensaje, sin stack.
 * Toda llamada de edit/execute deja además su propia fila `MCP_TOOL_CALL`,
 * aunque la tool se olvide de auditar.
 */
export const callCrmTool = async (
  caller: McpCaller,
  name: string,
  input: unknown,
  signal?: AbortSignal
): Promise<CallToolResult> => {
  if (!canUseTool(name, caller.scopes)) {
    return errorResult(`Tu conexión no tiene permiso para usar ${name}.`);
  }
  const tool: ToolName = name;
  const access = TOOL_CATALOG[tool].access;
  const definition = toolDefinition(tool);
  const args = input ?? {};

  let result: CallToolResult;
  let failure: string | null = null;
  try {
    const output = await definition.execute(args, toolContext(caller, tool, signal));
    let plain = toPlain(output);
    if (definition.toModelOutput) {
      const projected = await definition.toModelOutput(output);
      plain = projected.type === "json" ? toPlain(projected.value) : projected.value;
    }
    const structured =
      plain && typeof plain === "object" && !Array.isArray(plain)
        ? (plain as Record<string, unknown>)
        : { result: plain };
    result = {
      content: [{ type: "text", text: typeof plain === "string" ? plain : JSON.stringify(plain) }],
      structuredContent: structured,
    };
  } catch (error) {
    failure = error instanceof Error && error.message ? error.message : "La herramienta falló.";
    result = errorResult(failure);
  }

  if (access !== "read") {
    await writeAuditLog({
      staffUserId: caller.staffId,
      action: "MCP_TOOL_CALL",
      entityType: "McpTool",
      entityId: tool,
      changes: {
        tool,
        access,
        tokenId: caller.tokenId,
        tokenName: caller.tokenName,
        via: caller.via,
        input: sanitizeToolInput(args, 0, tool),
        ok: failure === null,
        ...(failure ? { error: failure.slice(0, 500) } : {}),
      },
    }).catch((error) => console.error("[mcp] no se pudo auditar", tool, error));
  }
  return result;
};

/** Registra en `server` cada herramienta que `caller` puede usar. */
export const registerCrmTools = (server: McpServer, caller: McpCaller) => {
  for (const name of visibleTools(caller.scopes)) {
    const entry = TOOL_CATALOG[name];
    const definition = toolDefinition(name);
    server.registerTool(
      name,
      {
        title: entry.label,
        description: definition.description,
        // Los esquemas de las tools son zod 4: implementan Standard Schema + JSON Schema.
        inputSchema: definition.inputSchema as StandardSchemaWithJSON,
        annotations: {
          title: entry.label,
          readOnlyHint: entry.access === "read",
          destructiveHint: entry.access === "execute",
          idempotentHint: entry.access === "read",
          openWorldHint: entry.access === "execute",
        },
      },
      async (args, ctx) => callCrmTool(caller, name, args, ctx.mcpReq.signal)
    );
  }
};

/** Un servidor suelto (lo usa la entrada stdio de pruebas). */
export const newCrmMcpServer = (caller: McpCaller): McpServer => {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
  registerCrmTools(server, caller);
  return server;
};

/** Handler HTTP (Streamable HTTP, sin estado) para una petición de `caller`. */
export const createCrmMcpHandler = (caller: McpCaller) =>
  createMcpHandler((server) => registerCrmTools(server, caller), {
    serverInfo: MCP_SERVER_INFO,
    instructions: MCP_INSTRUCTIONS,
  });

/** `AuthInfo` del SDK ↔ quien llama. `extra` lleva la identidad; `scopes`, los efectivos. */
export const authInfoFor = (token: string, caller: McpCaller): AuthInfo => ({
  token,
  clientId: caller.tokenId,
  scopes: caller.scopes,
  ...(caller.expiresAt ? { expiresAt: Math.floor(caller.expiresAt.getTime() / 1000) } : {}),
  extra: { caller },
});

export const callerFromAuthInfo = (auth: AuthInfo | undefined): McpCaller | null => {
  const caller = auth?.extra?.caller as McpCaller | undefined;
  return caller && typeof caller.staffId === "string" ? caller : null;
};
