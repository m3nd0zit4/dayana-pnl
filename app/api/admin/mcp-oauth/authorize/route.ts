import { getStaffSession } from "@/lib/auth/staff-session";
import { approveAuthorization, checkAuthorizationRequest, denyAuthorization } from "@/lib/mcp/oauth";
import { requestOrigin } from "@/lib/mcp/oauth-http";

/**
 * El «Permitir» / «Cancelar» de /admin/autorizar-mcp. Bajo /api/admin: el proxy
 * ya exige sesión del equipo y que el formulario venga de este mismo origen.
 * Vuelve a validar toda la petición (no se fía del GET) y redirige al cliente
 * con el código o con `error=access_denied`.
 */

export const runtime = "nodejs";

const see = (url: string) => new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });

export const POST = async (req: Request) => {
  const staff = await getStaffSession();
  if (!staff) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const form = await req.formData();
  const params = new URLSearchParams();
  for (const [key, value] of form) {
    if (typeof value === "string") params.append(key, value);
  }
  const origin = requestOrigin(req);
  const check = await checkAuthorizationRequest(params, origin);
  if (check.kind === "fatal") return new Response(check.message, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (check.kind === "redirect") return see(check.url);

  if (params.get("decision") !== "approve") return see(denyAuthorization(check.request, origin));
  return see(
    await approveAuthorization({
      staff: { id: staff.id, role: staff.role },
      client: check.client,
      request: check.request,
      chosen: params.getAll("grant_scope"),
      origin,
    })
  );
};
