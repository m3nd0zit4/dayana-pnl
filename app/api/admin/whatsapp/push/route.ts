import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson, withStaff } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { sendPushToStaff, webPushPublicKey } from "@/lib/notifications/channels/push";

export const dynamic = "force-dynamic";

/** Clave pública para suscribirse y cuántos dispositivos tiene esta persona. */
export const GET = withStaff("read", async ({ staff }) =>
  NextResponse.json({
    publicKey: webPushPublicKey(),
    devices: await prisma.pushSubscription.count({ where: { staffUserId: staff.id } }),
  })
);

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  test: z.boolean().optional(),
});

/** Guarda la suscripción de este navegador (y opcionalmente manda una prueba). */
export const POST = withStaff("read", async ({ req, staff }) => {
  const parsed = subscribeSchema.safeParse(await readJson(req));
  if (!parsed.success) return apiError("invalid_body", 400);
  const { endpoint, keys, test } = parsed.data;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      staffUserId: staff.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
    update: { staffUserId: staff.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  const sent = test
    ? await sendPushToStaff([staff.id], {
        title: "Avisos activados",
        body: "Así te llegará cuando la IA de WhatsApp te necesite.",
        href: "/admin/whatsapp",
        tag: "push-test",
      })
    : 0;
  return NextResponse.json({ ok: true, sent });
});

export const DELETE = withStaff("read", async ({ req, staff }) => {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return apiError("invalid_body", 400);
  await prisma.pushSubscription.deleteMany({ where: { endpoint, staffUserId: staff.id } });
  return NextResponse.json({ ok: true });
});
