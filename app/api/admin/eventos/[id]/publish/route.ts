import { withStaff } from "@/lib/api/handler";
import { publishEventResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Publica el evento y cierra las inscripciones del que estuviera publicado. */
export const POST = withStaff<{ id: string }>("write", async ({ staff, params }) =>
  publishEventResponse(params.id, staff.id)
);
