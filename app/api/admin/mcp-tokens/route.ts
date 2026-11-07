import { z } from "zod";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { roleScopes } from "@/lib/mcp/scopes";
import { EXPIRY_OPTIONS } from "@/lib/mcp/token-format";
import { createMcpToken, listMcpTokens, McpTokenError } from "@/lib/mcp/tokens";

/**
 * Conexiones MCP (tokens personales). Cualquier rol con acceso MCP gestiona
 * las suyas; el OWNER ve las de todo el equipo. El token en claro sale una
 * sola vez, en la respuesta del POST.
 */

export const GET = withStaff("read", async ({ staff }) => {
  const tokens = await listMcpTokens({ id: staff.id, role: staff.role });
  return Response.json({ tokens, allowedScopes: roleScopes(staff.role), viewerId: staff.id });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string()).min(1).max(3),
  expiresInDays: z.union([z.literal(EXPIRY_OPTIONS[0]), z.literal(EXPIRY_OPTIONS[1]), z.literal(EXPIRY_OPTIONS[2]), z.null()]),
});

const STATUS: Record<McpTokenError["code"], number> = {
  no_access: 403,
  forbidden: 403,
  scope_exceeds_role: 403,
  invalid_name: 400,
  invalid_scopes: 400,
  too_many: 409,
  not_found: 404,
};

export const POST = withStaff("read", async ({ req, staff }) => {
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400, { detail: "Revisa el nombre, los permisos y la caducidad." });
  try {
    const { token, record } = await createMcpToken({
      staff: { id: staff.id, role: staff.role },
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresInDays: parsed.data.expiresInDays,
    });
    return Response.json({ token, record }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof McpTokenError) return apiError(error.code, STATUS[error.code], { detail: error.message });
    throw error;
  }
});
