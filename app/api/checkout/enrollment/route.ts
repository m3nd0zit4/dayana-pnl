import { NextRequest, NextResponse } from "next/server";
import { isPlanId } from "@/lib/plans";
import { isActivePlanId } from "@/lib/plans-from-db";
import { createPendingPaymentEnrollment } from "@/lib/crm/enrollments";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  planId?: string;
  contactId?: string;
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`checkout:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.planId || !isPlanId(body.planId) || !(await isActivePlanId(body.planId))) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  try {
    const enrollment = await createPendingPaymentEnrollment({
      productId: body.planId,
      contactId: body.contactId,
    });

    return NextResponse.json({
      enrollmentId: enrollment.id,
      contactId: enrollment.contactId,
      productId: enrollment.productId,
      status: enrollment.status,
    });
  } catch (e) {
    console.error("[checkout/enrollment]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
