import { withStaff } from "@/lib/api/handler";
import { duplicateEventResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Un borrador nuevo con la página de este (sin fecha, enlace ni inscritas). */
export const POST = withStaff<{ id: string }>("write", async ({ staff, params }) =>
  duplicateEventResponse(params.id, staff.id)
);
