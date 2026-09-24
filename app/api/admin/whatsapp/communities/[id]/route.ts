import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import {
  COMMUNITY_KINDS,
  CommunityError,
  MEMBER_STATUSES,
  addMembers,
  announce,
  getCommunity,
  invite,
  markJoinedByPhones,
  setMemberStatus,
  updateCommunity,
} from "@/lib/crm/whatsapp-communities";
import { whatsAppStatusFor } from "@/lib/crm/whatsapp-outbound";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { id: string };

/** La comunidad con sus miembros y el estado de WhatsApp de cada una. */
export const GET = withStaff<Params>("read", async ({ params }) => {
  const community = await getCommunity(params.id);
  if (!community) return apiError("not_found", 404);
  const statuses = await whatsAppStatusFor(community.members.map((m) => m.contactId));
  return NextResponse.json({ community, statuses });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(COMMUNITY_KINDS).optional(),
  parentId: z.string().max(60).nullish(),
  inviteLink: z.string().trim().max(500).url().nullish().or(z.literal("")),
  description: z.string().trim().max(2000).nullish(),
  archived: z.boolean().optional(),
});

export const PATCH = withStaff<Params>("write", async ({ req, params }) => {
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const exists = await prisma.whatsAppCommunity.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!exists) return apiError("not_found", 404);
  return NextResponse.json(await updateCommunity(params.id, parsed.data));
});

const ids = z.array(z.string().max(60)).max(2000);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_members"), contactIds: ids.min(1), status: z.enum(MEMBER_STATUSES).default("INVITED") }),
  z.object({ action: z.literal("set_status"), contactIds: ids.min(1), status: z.enum(MEMBER_STATUSES) }),
  /** `apply: false` solo dice a quién encontró, para confirmar antes. */
  z.object({ action: z.literal("mark_joined_paste"), text: z.string().max(50_000), apply: z.boolean().default(false) }),
  z.object({ action: z.literal("invite"), contactIds: ids.optional(), text: z.string().trim().max(4000).optional() }),
  z.object({ action: z.literal("announce"), text: z.string().trim().min(1).max(4000) }),
]);

export const POST = withStaff<Params>("write", async ({ req, staff, params }) => {
  const parsed = actionSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const input = parsed.data;
  const exists = await prisma.whatsAppCommunity.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!exists) return apiError("not_found", 404);
  try {
    switch (input.action) {
      case "add_members":
        return NextResponse.json({ added: await addMembers(params.id, input.contactIds, input.status) });
      case "set_status":
        return NextResponse.json({ updated: await setMemberStatus(params.id, input.contactIds, input.status) });
      case "mark_joined_paste":
        return NextResponse.json(await markJoinedByPhones(params.id, input.text, { apply: input.apply }));
      case "invite":
        // `id`: el envío que la pantalla ejecuta por tandas, como cualquier envío masivo.
        return NextResponse.json(
          await invite(params.id, input.contactIds, staff.id, { text: input.text }).then((r) => ({ id: r.sendId, total: r.total }))
        );
      case "announce":
        return NextResponse.json(
          await announce(params.id, input.text, staff.id).then((r) => ({ id: r.sendId, total: r.total }))
        );
    }
  } catch (e) {
    if (e instanceof CommunityError) return apiError(e.code, e.code === "not_found" ? 404 : 400, { message: e.message });
    throw e;
  }
});
