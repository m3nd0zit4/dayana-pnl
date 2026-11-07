import { apiError, withStaff } from "@/lib/api/handler";
import { McpTokenError, revokeMcpToken } from "@/lib/mcp/tokens";

/** Revocar = dejar de valer al instante. La fila se queda para el historial. */
export const DELETE = withStaff<{ id: string }>("read", async ({ staff, params }) => {
  try {
    const record = await revokeMcpToken({ id: staff.id, role: staff.role }, params.id);
    return Response.json({ record });
  } catch (error) {
    if (error instanceof McpTokenError) {
      return apiError(error.code, error.code === "not_found" ? 404 : 403, { detail: error.message });
    }
    throw error;
  }
});
