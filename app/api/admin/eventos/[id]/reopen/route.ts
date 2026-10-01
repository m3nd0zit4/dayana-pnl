import { withStaff } from "@/lib/api/handler";
import { reopenEventResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Reabrir uno terminado por error: queda sin inscripciones hasta publicarlo. */
export const POST = withStaff<{ id: string }>("write", async ({ staff, params }) =>
  reopenEventResponse(params.id, staff.id)
);
