import { withStaff } from "@/lib/api/handler";
import { reopenWorkshopResponse } from "../../_lib/lifecycle";

export const dynamic = "force-dynamic";

/** Reabrir una terminada por error: queda cerrada hasta volver a publicarla. */
export const POST = withStaff<{ slug: string }>("write", async ({ staff, params }) =>
  reopenWorkshopResponse(params.slug, staff)
);
