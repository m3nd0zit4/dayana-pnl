import { NextRequest, NextResponse } from "next/server";
import { abandonCheckoutEnrollment } from "@/lib/crm/checkout-placeholder";
import {
  clientIp,
  rateLimitDistributed,
} from "@/lib/api/rate-limit-distributed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { enrollmentId?: string };

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = await rateLimitDistributed(`checkout:abandon:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const enrollmentId =
    typeof body.enrollmentId === "string" ? body.enrollmentId.trim() : "";
  if (!enrollmentId) {
    return NextResponse.json({ error: "missing_enrollment" }, { status: 400 });
  }

  const result = await abandonCheckoutEnrollment(enrollmentId);
  return NextResponse.json({ ok: true, ...result });
}
