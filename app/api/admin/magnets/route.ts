import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWriteStaff, resolveAdminStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import {
  createMagnet,
  listMagnetsForAdmin,
  normalizeKeyword,
} from "@/lib/crm/magnets";

export const dynamic = "force-dynamic";

export const magnetSchema = z.object({
  keyword: z.string().trim().min(2).max(40),
  label: z.string().trim().max(40).optional(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  /**
   * Enlace externo (https) o archivo ya subido (`/api/media/material/...`).
   * Nada más: un `javascript:` aquí acabaría en el botón de una página
   * pública y en el botón de un correo.
   */
  deliveryUrl: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .refine(
      (u) => /^https:\/\//i.test(u) || u.startsWith("/api/media/material/"),
      "invalid_url"
    ),
  replyText: z.string().trim().max(600).optional().nullable(),
  dmText: z.string().trim().max(600).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const staff = await resolveAdminStaff();
  if (staff instanceof NextResponse) return staff;

  const magnets = await listMagnetsForAdmin();
  return NextResponse.json({ magnets });
}

export async function POST(req: NextRequest) {
  const staff = await requireWriteStaff();
  if (staff instanceof NextResponse) return staff;

  const parsed = magnetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path.at(-1) ?? "");
    return NextResponse.json(
      { error: field === "deliveryUrl" ? "invalid_url" : "invalid_body" },
      { status: 400 }
    );
  }

  if (!normalizeKeyword(parsed.data.keyword)) {
    return NextResponse.json({ error: "invalid_keyword" }, { status: 400 });
  }

  try {
    const magnet = await createMagnet(parsed.data);
    fireAuditLog({
      staffUserId: staff.id,
      action: "CREATE",
      entityType: "KeywordMagnet",
      entityId: magnet.id,
      changes: { keyword: magnet.keyword },
    });
    return NextResponse.json({ magnet });
  } catch (e) {
    if (e instanceof Error && e.message === "KEYWORD_TAKEN") {
      return NextResponse.json({ error: "keyword_taken" }, { status: 409 });
    }
    throw e;
  }
}
