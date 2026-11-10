import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { getUiState, isUiStateKey, setUiState } from "@/lib/crm/ui-state";

/** Small UI state that follows the staff member across devices (allow-listed keys only). */
export const GET = withStaff<{ key: string }>("read", async ({ staff, params }) => {
  if (!isUiStateKey(params.key)) return apiError("not_found", 404);
  return Response.json({ value: await getUiState(staff.id, params.key) });
});

export const PUT = withStaff<{ key: string }>("read", async ({ req, staff, params }) => {
  if (!isUiStateKey(params.key)) return apiError("not_found", 404);
  const body = (await readJson(req)) as { value?: unknown } | null;
  if (!body || !("value" in body)) return apiError("invalid_body", 400);
  return (await setUiState(staff.id, params.key, body.value)) ? new Response(null, { status: 204 }) : apiError("too_large", 413);
});
