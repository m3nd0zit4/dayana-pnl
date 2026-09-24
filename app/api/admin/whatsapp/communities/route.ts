import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { COMMUNITY_KINDS, createCommunity, listCommunities } from "@/lib/crm/whatsapp-communities";

export const dynamic = "force-dynamic";

/** Comunidades y grupos de WhatsApp con cuántas están / invitadas. */
export const GET = withStaff("read", async ({ req }) => {
  const url = new URL(req.url);
  const items = await listCommunities({
    q: url.searchParams.get("q") ?? undefined,
    archived: url.searchParams.get("archived") === "1",
  });
  return NextResponse.json({ items });
});

const communitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(COMMUNITY_KINDS).default("group"),
  parentId: z.string().max(60).nullish(),
  inviteLink: z.string().trim().max(500).url().nullish().or(z.literal("")),
  description: z.string().trim().max(2000).nullish(),
});

export const POST = withStaff("write", async ({ req, staff }) => {
  const parsed = communitySchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const created = await createCommunity(parsed.data, staff.id);
  return NextResponse.json(created);
});
