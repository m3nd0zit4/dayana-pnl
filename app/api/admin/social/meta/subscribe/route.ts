import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { fireAuditLog } from "@/lib/crm/audit";
import { saveWebhookState } from "@/lib/crm/social-accounts";
import { openSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import { subscribePageWebhooks } from "@/lib/meta/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reintenta la suscripción de la Página cuando falló al conectar. */
export const POST = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const account = await prisma.socialAccount.findFirst({
    where: { provider: "FACEBOOK", isActive: true },
    select: { externalId: true, accessTokenEnc: true },
  });

  if (!account?.accessTokenEnc) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }

  const webhook = await subscribePageWebhooks(
    account.externalId,
    openSecret(account.accessTokenEnc)
  );
  await saveWebhookState(account.externalId, webhook);

  fireAuditLog({
    staffUserId: staff.id,
    action: "SOCIAL_WEBHOOK_SUBSCRIBED",
    entityType: "SocialAccount",
    entityId: account.externalId,
    changes: { subscribed: webhook.subscribed, fields: webhook.fields },
  });

  return NextResponse.json(webhook);
};
