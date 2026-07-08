import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractWorkshopFields } from "@/lib/ai/workshop-extraction";
import { isAiConfigured } from "@/lib/ai/gemini";
import { rateLimitDistributed } from "@/lib/api/rate-limit-distributed";
import { requireWriteStaff } from "@/lib/auth/api-staff";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().min(10).max(8000),
});

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
  }

  const rl = await rateLimitDistributed(`ai-extract:${staff.id}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const fields = await extractWorkshopFields(parsed.data.text);
    return NextResponse.json({ fields });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/quota|resource.?exhausted|too many|429/i.test(msg)) {
      return NextResponse.json({ error: "ai_quota" }, { status: 429 });
    }
    return NextResponse.json({ error: "ai_failed" }, { status: 502 });
  }
}
