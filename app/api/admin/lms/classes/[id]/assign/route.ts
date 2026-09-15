import { NextResponse } from "next/server";
import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { assignClassToModule } from "@/lib/lms/course-admin";
import { assignClassModuleSchema } from "@/lib/validations/admin";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  const { id } = params;
  const parsed = assignClassModuleSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return apiError("invalid_body", 400);
  }

  const liveClass = await assignClassToModule(id, parsed.data.moduleId).catch(
    () => null
  );
  if (!liveClass) {
    return apiError("not_found", 404);
  }

  fireAuditLog({
    staffUserId: staff.id,
    action: "UPDATE",
    entityType: "LiveClassSession",
    entityId: id,
    changes: { moduleId: parsed.data.moduleId },
  });

  return NextResponse.json({ liveClass });
});
