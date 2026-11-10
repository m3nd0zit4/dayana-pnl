import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { writeAuditLog } from "@/lib/crm/audit";
import { CALL_FUNNEL_SETTING_KEY, getCallFunnelConfig, setCallFunnelConfig } from "@/lib/crm/call-funnel/config";
import type { CallFunnelConfig } from "@/lib/crm/call-funnel/rules";
import { canManageTeam } from "@/lib/crm/staff-permissions";

export const dynamic = "force-dynamic";

type Editable = Pick<CallFunnelConfig, "enabled" | "days" | "perDay">;

/** Un entero dentro del rango; nada de recortar en silencio lo que llegue mal. */
const intIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const editable = (config: CallFunnelConfig): Editable => ({ enabled: config.enabled, days: config.days, perDay: config.perDay });

/**
 * Los ajustes de la página de la llamada gratis (`/llamada`) desde «Embudo»:
 * cuántos días y cuántas horas por día se muestran (quien puede escribir en el
 * CRM) y abrirla o cerrarla (solo la dueña). Los mismos límites que
 * `parseFunnelConfig`: días 1–7, horas por día 2–12.
 */
export const PATCH = withStaff("write", async ({ req, staff }) => {
  const body = (await readJson(req)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_body", 400);

  const patch: Partial<Editable> = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return apiError("invalid_enabled", 400);
    // Abrir o cerrar la página pública es decisión de la dueña.
    if (!canManageTeam(staff.role)) return apiError("forbidden", 403);
    patch.enabled = body.enabled;
  }
  if (body.days !== undefined) {
    if (!intIn(body.days, 1, 7)) return apiError("invalid_days", 400);
    patch.days = body.days;
  }
  if (body.perDay !== undefined) {
    if (!intIn(body.perDay, 2, 12)) return apiError("invalid_per_day", 400);
    patch.perDay = body.perDay;
  }
  if (Object.keys(patch).length === 0) return apiError("invalid_body", 400);

  const before = editable(await getCallFunnelConfig());
  const after = editable(await setCallFunnelConfig(patch));

  await writeAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "SiteSetting",
    entityId: CALL_FUNNEL_SETTING_KEY,
    changes: { before, after },
  }).catch((e: unknown) => console.warn("[embudo] no se pudo auditar el cambio de ajustes", e));

  return NextResponse.json({ ok: true, config: after });
});
