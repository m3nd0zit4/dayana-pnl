import { NextResponse } from "next/server";
import { apiError, withStaff } from "@/lib/api/handler";
import { fireAuditLog } from "@/lib/crm/audit";
import { saveWebhookState } from "@/lib/crm/social-accounts";
import { openSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import { subscribePageWebhooks } from "@/lib/meta/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reintenta la suscripción de la Página cuando falló al conectar. */
export const POST = withStaff("owner", async ({ staff }) => {
  const account = await prisma.socialAccount.findFirst({
    where: { provider: "FACEBOOK", isActive: true },
    select: { externalId: true, accessTokenEnc: true },
  });

  if (!account?.accessTokenEnc) {
    return apiError("not_connected", 400);
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
});
