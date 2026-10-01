import { withStaff } from "@/lib/api/handler";
import { endEventResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Da el evento por realizado: corta inscripciones, enlace y recordatorios. */
export const POST = withStaff<{ id: string }>("write", async ({ staff, params }) =>
  endEventResponse(params.id, staff.id)
);
