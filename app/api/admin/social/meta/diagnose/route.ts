import { NextResponse } from "next/server";
import { requireOwnerStaff } from "@/lib/auth/api-staff";
import { openSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import {
  diagnoseAppSubscription,
  readPageSubscription,
} from "@/lib/meta/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnóstico bajo demanda — nunca en render, porque hace red.
 *
 * Responde a la pregunta que más veces explica una bandeja muda: ¿a qué URL
 * está mandando Meta los webhooks, y sigue la Página suscrita?
 */
export const GET = async () => {
  const staff = await requireOwnerStaff();
  if (staff instanceof NextResponse) return staff;

  const account = await prisma.socialAccount.findFirst({
    where: { provider: "FACEBOOK", isActive: true },
    select: { externalId: true, accessTokenEnc: true },
  });

  const [app, page] = await Promise.all([
    diagnoseAppSubscription(),
    account?.accessTokenEnc
      ? readPageSubscription(account.externalId, openSecret(account.accessTokenEnc))
      : Promise.resolve(null),
  ]);

  return NextResponse.json({ app, page });
};
