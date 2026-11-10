/**
 * CLI del CRM para IAs externas (Claude Code, Codex, un script): habla con el
 * servidor MCP del CRM (`/api/mcp`) por HTTP, con JSON-RPC sobre Streamable
 * HTTP, igual que cualquier cliente MCP. No toca la base ni importa código del
 * servidor: lo que puede hacer es exactamente lo que el token puede hacer por
 * MCP (mismos scopes, misma auditoría con el nombre de la conexión).
 *
 *   bun run crm tools [--json]           herramientas que tu token puede usar
 *   bun run crm describe <herramienta>   descripción y esquema de entrada
 *   bun run crm call <herramienta> ['<json>' | - | @archivo.json]   llama y escribe el JSON
 *   bun run crm info                     instrucciones del servidor
 *
 * Variables:
 *   CRM_MCP_TOKEN  token de Ajustes → Conexiones MCP (`dpnl_…`) o un access
 *                  token OAuth (`dpat_…`). Obligatorio. Nunca por argumento:
 *                  quedaría en el historial de la terminal.
 *   CRM_MCP_URL    por defecto https://www.dayanabeltran.com/api/mcp (con
 *                  `www`: el ápice responde 308 a un POST). Para desarrollo,
 *                  http://localhost:3100/api/mcp.
 *
 * Salida: el resultado va a stdout como JSON; los errores a stderr como
 * `{"error": "...", ...}`. Códigos: 0 bien, 1 la herramienta falló, 2 uso
 * incorrecto o herramienta inexistente/sin permiso, 3 conexión o
 * autenticación, 4 resultado desconocido (una llamada que se cortó o dio 5xx:
 * pudo haberse hecho; no la repitas sin comprobarlo). Ver docs/mcp.md.
 */
import { TOOL_CATALOG } from "@/lib/crm-tools/catalog";

const DEFAULT_URL = "https://www.dayanabeltran.com/api/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 90_000;

type Access = "read" | "edit" | "execute";

type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
};

type CallResult = {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

class CliError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const HELP = `Uso: bun run crm <comando>

  tools [--json]                 Herramientas que tu token puede usar, con su nivel
                                 (read / edit / execute).
  describe <herramienta>         Descripción y esquema de entrada (JSON Schema).
  call <herramienta> [json | - | @archivo]
                                 Llama a la herramienta. El argumento es un objeto
                                 JSON; «-» lo lee de stdin, «@archivo.json» de un
                                 archivo; sin él, {}. En PowerShell, stdin o archivo.
  info                           Nombre, versión e instrucciones del servidor.

Variables: CRM_MCP_TOKEN (obligatoria; Ajustes → Conexiones MCP),
CRM_MCP_URL (por defecto ${DEFAULT_URL}).
Las herramientas «execute» llegan a personas reales (WhatsApp, correo, SMS,
pagos): confírmalo con quien te pidió la tarea antes de llamarlas.`;

/** El nivel, leído de las anotaciones que pone el servidor (`lib/mcp/server.ts`). */
const accessOf = (tool: McpTool): Access =>
  tool.annotations?.readOnlyHint ? "read" : tool.annotations?.destructiveHint ? "execute" : "edit";

const endpoint = (): URL => {
  const raw = process.env.CRM_MCP_URL?.trim() || DEFAULT_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new CliError(`CRM_MCP_URL tiene que ser https (o localhost): ${url.origin}`, 2);
    }
    return url;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`CRM_MCP_URL no es una URL válida: ${raw}`, 2);
  }
};

const token = (): string => {
  const value = process.env.CRM_MCP_TOKEN?.trim();
  if (!value) {
    throw new CliError(
      "Falta CRM_MCP_TOKEN. Crea una conexión en el CRM (Ajustes → Conexiones MCP) y exporta su token.",
      3
    );
  }
  return value;
};

/**
 * Una llamada a herramienta sin respuesta (timeout, conexión cortada, 5xx como
 * el 504 de Vercel a los 60 s): pudo haberse ejecutado. Código 4, para que una
 * IA no la repita a ciegas y mande dos veces el mismo WhatsApp o correo.
 */
const unknownOutcome = (url: URL, reason: string) =>
  new CliError(
    `No se sabe si la herramienta se ejecutó (${reason}). No la repitas sin comprobar antes en el CRM (por ejemplo con una herramienta de lectura o query_audit_log).`,
    4,
    { outcome: "unknown", endpoint: `${url.origin}${url.pathname}` }
  );

let nextId = 0;
let sessionId: string | null = null;

/** Las respuestas llegan como JSON o como un stream SSE con el mensaje en `data:`. */
const parseBody = (text: string, contentType: string, id: number): Record<string, unknown> | null => {
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const message = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        if (message.id === id) return message;
      } catch {
        // una línea que no es JSON: se ignora
      }
    }
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const post = async (method: string, params: Record<string, unknown>) => {
  const url = endpoint();
  const id = ++nextId;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    authorization: `Bearer ${token()}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Una llamada a una herramienta que se cortó pudo haber llegado y hecho su
    // trabajo (un envío masivo): no es «sin conexión, reintenta».
    // Si ni siquiera conectó (rechazada, DNS, TLS), no llegó: eso sí es «sin conexión».
    const code = String((error as { code?: unknown })?.code ?? (error as { cause?: { code?: unknown } })?.cause?.code ?? "");
    const neverSent = /ConnectionRefused|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|CERT|TLS|FailedToOpenSocket/i.test(code);
    if (method === "tools/call" && !neverSent) throw unknownOutcome(url, reason);
    throw new CliError(`No se pudo conectar con ${url.origin}: ${reason}`, 3);
  }

  const session = res.headers.get("mcp-session-id");
  if (session) sessionId = session;
  const text = await res.text();

  if (res.status === 401) {
    throw new CliError(
      "401: el token no vale (inventado, revocado, caducado o de otra base: los de producción no sirven en desarrollo ni al revés). Crea otro en Ajustes → Conexiones MCP.",
      3,
      { status: 401 }
    );
  }
  if (res.status === 403) throw new CliError("403: el servidor rechazó la petición.", 3, { status: 403 });
  if (res.status === 429) {
    throw new CliError("429: demasiadas peticiones con este token (120 por minuto). Espera un minuto.", 3, {
      status: 429,
      retryAfter: res.headers.get("retry-after"),
    });
  }
  if (res.status >= 300 && res.status < 400) {
    throw new CliError(
      `${res.status}: el servidor redirige a ${res.headers.get("location") ?? "otro sitio"}. Usa esa URL en CRM_MCP_URL (en producción, con www).`,
      3,
      { status: res.status }
    );
  }

  const body = parseBody(text, res.headers.get("content-type") ?? "", id);
  if (method === "tools/call" && res.status >= 500 && !body) throw unknownOutcome(url, `HTTP ${res.status}`);
  if (!res.ok && !body) {
    throw new CliError(`HTTP ${res.status} de ${url.origin}${url.pathname}`, 3, {
      status: res.status,
      body: text.slice(0, 300),
    });
  }
  if (!body) throw new CliError(`Respuesta vacía o ilegible de ${url.origin}${url.pathname} (HTTP ${res.status}).`, 3);
  return body;
};

/**
 * Una llamada JSON-RPC. El servidor no guarda sesión (cada petición basta),
 * pero si alguna vez exige `initialize` primero, se hace una vez y se repite.
 */
const rpc = async (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  let body = await post(method, params);
  const error = body.error as { code?: number; message?: string } | undefined;
  if (error && method !== "initialize" && /not initialized|session/i.test(error.message ?? "")) {
    await initialize();
    body = await post(method, params);
  }
  return body;
};

const initialize = async () => {
  const body = await post("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "dayana-crm-cli", version: "1.0.0" },
  });
  const error = body.error as { message?: string } | undefined;
  if (error) throw new CliError(`initialize falló: ${error.message ?? "sin mensaje"}`, 3);
  return body.result as Record<string, unknown>;
};

const listTools = async (): Promise<McpTool[]> => {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const body = await rpc("tools/list", cursor ? { cursor } : {});
    const error = body.error as { message?: string } | undefined;
    if (error) throw new CliError(`tools/list falló: ${error.message ?? "sin mensaje"}`, 3);
    const result = (body.result ?? {}) as { tools?: McpTool[]; nextCursor?: string };
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  return tools;
};

/** Por qué no aparece: no existe, o existe y el token no tiene su scope. */
const missingTool = (name: string, visible: McpTool[]): CliError => {
  const known = (TOOL_CATALOG as Record<string, { access: Access }>)[name];
  if (known) {
    return new CliError(
      `Tu token no tiene permiso para «${name}»: necesita el scope «${known.access}». Pide una conexión con ese permiso en Ajustes → Conexiones MCP (y que tu rol lo permita).`,
      2,
      { tool: name, needs: known.access }
    );
  }
  const close = visible
    .map((t) => t.name)
    .filter((n) => n.includes(name) || name.includes(n) || n.split("_").some((part) => part.length > 3 && name.includes(part)))
    .slice(0, 5);
  return new CliError(`No existe la herramienta «${name}». «bun run crm tools» lista las que puedes usar.`, 2, {
    tool: name,
    ...(close.length ? { didYouMean: close } : {}),
  });
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const readArgFile = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new CliError(`No existe el archivo de argumentos: ${path}`, 2);
  return file.text();
};

/** `'<json>'`, `-` (stdin) o `@archivo.json`. PowerShell 5.1 quita las comillas internas: ahí, stdin o archivo. */
const parseArgs = async (raw: string | undefined): Promise<Record<string, unknown>> => {
  if (raw === undefined) return {};
  const source = raw === "-" ? await readStdin() : raw.startsWith("@") ? await readArgFile(raw.slice(1)) : raw;
  // PowerShell antepone un BOM al canalizar texto.
  const text = source.replace(/^﻿/, "");
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError(
      `Los argumentos no son JSON válido (${error instanceof Error ? error.message : "error"}). Ejemplo: '{"q":"María"}'. En PowerShell las comillas se pierden: usa «-» (stdin) o «@archivo.json».`,
      2
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("Los argumentos tienen que ser un objeto JSON ({...}).", 2);
  }
  return value as Record<string, unknown>;
};

/** El resultado de una herramienta como JSON: el estructurado si lo hay, si no el texto. */
const resultJson = (result: CallResult): unknown => {
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

const print = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async tools(args) {
    const tools = await listTools();
    const rows = tools
      .map((t) => ({ name: t.name, access: accessOf(t), title: t.annotations?.title ?? t.title ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (args.includes("--json")) return print(rows);
    const width = Math.max(...rows.map((r) => r.name.length), 4);
    process.stdout.write(`${"NOMBRE".padEnd(width)}  NIVEL    TÍTULO\n`);
    for (const r of rows) process.stdout.write(`${r.name.padEnd(width)}  ${r.access.padEnd(7)}  ${r.title}\n`);
    const count = (a: Access) => rows.filter((r) => r.access === a).length;
    process.stdout.write(`\n${rows.length} herramientas: ${count("read")} read, ${count("edit")} edit, ${count("execute")} execute.\n`);
  },

  async describe(args) {
    const name = args[0];
    if (!name) throw new CliError("Falta la herramienta: bun run crm describe <herramienta>", 2);
    const tools = await listTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw missingTool(name, tools);
    print({
      name: tool.name,
      title: tool.annotations?.title ?? tool.title ?? null,
      access: accessOf(tool),
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? {},
    });
  },

  async call(args) {
    const name = args[0];
    if (!name) throw new CliError("Falta la herramienta: bun run crm call <herramienta> ['<json>' | - | @archivo.json]", 2);
    const input = await parseArgs(args[1]);
    const body = await rpc("tools/call", { name, arguments: input });
    const error = body.error as { code?: number; message?: string } | undefined;
    if (error) {
      // El servidor solo registra lo que el token puede ver: «not found» puede
      // ser una herramienta que existe pero queda fuera de sus scopes.
      if (/not found/i.test(error.message ?? "")) throw missingTool(name, await listTools());
      throw new CliError(error.message ?? "Error JSON-RPC sin mensaje", 2, { tool: name, code: error.code });
    }
    const result = (body.result ?? {}) as CallResult;
    if (result.isError) {
      const message = (result.content ?? []).map((c) => c.text ?? "").join("\n").trim() || "La herramienta falló.";
      if (/^Tool .+ not found/i.test(message)) throw missingTool(name, await listTools());
      throw new CliError(message, /permiso|^Input validation error/i.test(message) ? 2 : 1, { tool: name });
    }
    print(resultJson(result));
  },

  async info() {
    const result = await initialize();
    print({
      url: `${endpoint().origin}${endpoint().pathname}`,
      server: result.serverInfo ?? null,
      protocolVersion: result.protocolVersion ?? null,
      instructions: result.instructions ?? null,
    });
  },
};

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const run = commands[command];
  if (!run) throw new CliError(`Comando desconocido: «${command}».\n\n${HELP}`, 2);
  await run(args);
};

try {
  await main();
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`${JSON.stringify({ error: error.message, ...error.extra })}\n`);
    process.exit(error.code);
  }
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
}
