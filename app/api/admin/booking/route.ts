import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  bookingConfigSchema,
  getBookingConfig,
  listAppointments,
  setBookingConfig,
} from "@/lib/crm/booking";

export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () => {
  const [config, appointments] = await Promise.all([
    getBookingConfig(),
    listAppointments(),
  ]);
  return NextResponse.json({ config, appointments });
});

export const PATCH = withStaff("write", async ({ req, staff }) => {
  const parsed = bookingConfigSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  // Una franja que termina antes de empezar deja la agenda sin huecos y sin
  // decir por qué. Mejor rechazarla aquí.
  const broken = parsed.data.rules.find((r) => r.from >= r.to);
  if (broken) {
    return apiError("invalid_range", 400);
  }

  await setBookingConfig(parsed.data);

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "BookingConfig",
    entityId: "booking",
    changes: {
      isActive: parsed.data.isActive,
      durationMinutes: parsed.data.durationMinutes,
      rules: parsed.data.rules.length,
    },
  });

  return NextResponse.json({ config: parsed.data });
});
