import { NextResponse } from "next/server";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { listFreeEvents } from "@/lib/crm/free-events";
import { freeEventEditionsEnabled } from "@/lib/crm/free-event-settings";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { freeEventCreateSchema } from "@/lib/validations/free-event";
import { createEventResponse } from "./_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Todos los eventos gratuitos, como la lista de talleres. */
export const GET = withStaff("read", async () =>
  NextResponse.json({
    events: await listFreeEvents(),
    editionsEnabled: await freeEventEditionsEnabled(),
    operationalTimezone: await getOperationalTimezone(),
  })
);

/** «Nuevo evento»: un borrador, opcionalmente con la página de otro. */
export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = freeEventCreateSchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return apiError("invalid_body", 400);
  return createEventResponse(
    {
      headline: parsed.data.headline ?? null,
      startsAtLocal: parsed.data.startsAtLocal ?? null,
      copyFromId: parsed.data.copyFromId ?? null,
    },
    staff.id
  );
});
