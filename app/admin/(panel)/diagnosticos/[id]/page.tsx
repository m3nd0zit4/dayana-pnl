import { notFound } from "next/navigation";
import DiagnosticDetailClient from "@/app/components/admin/crm/DiagnosticDetailClient";
import DiagnosticOutreachCard from "@/app/components/admin/crm/DiagnosticOutreachCard";
import { prisma } from "@/lib/db";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getDiagnosticById } from "@/lib/crm/diagnostics";
import {
  getOperationalTimezone,
  OPERATIONAL_TZ,
} from "@/lib/crm/operational-timezone";
import { PREVIEW_DIAGNOSTICS } from "@/lib/crm/preview-data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Ficha de un diagnóstico: qué contestó la persona, cuándo, y qué tan cerca
 * está de decidirse. El id no se lee en vista previa — `isCrmUiPreview()`
 * siempre enseña el primer registro de muestra, igual que hacen el resto de
 * detalles del panel (ver `e2e/routes.ts`).
 *
 * La zona horaria se resuelve aquí y viaja al cliente: las fechas se formatean
 * con ella en los dos lados y el HTML coincide al hidratar.
 */
const DiagnosticoDetailPage = async ({ params }: Props) => {
  const { id } = await params;

  if (isCrmUiPreview()) {
    return (
      <DiagnosticDetailClient
        diagnostic={PREVIEW_DIAGNOSTICS[0]}
        timeZone={OPERATIONAL_TZ}
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const [diagnostic, timeZone, outreach] = await Promise.all([
    getDiagnosticById(id),
    getOperationalTimezone().catch(() => OPERATIONAL_TZ),
    prisma.diagnostic.findUnique({
      where: { id },
      select: {
        aiAnalysis: true,
        outreachStatus: true,
        outreachReason: true,
        outreachAt: true,
        outreachConversationId: true,
        completedAt: true,
      },
    }),
  ]);
  if (!diagnostic) notFound();
  // El estado real del primer mensaje (el mismo que se ve en el chat).
  const firstMessage = outreach?.outreachConversationId
    ? await prisma.conversationMessage.findFirst({
        where: { conversationId: outreach.outreachConversationId, direction: "OUTBOUND" },
        orderBy: { sentAt: "desc" },
        select: { status: true, failedReason: true },
      })
    : null;

  return (
    <DiagnosticDetailClient
      diagnostic={diagnostic}
      timeZone={timeZone}
      outreach={
        outreach?.completedAt ? (
          <DiagnosticOutreachCard
            diagnosticId={id}
            analysis={outreach.aiAnalysis as never}
            status={outreach.outreachStatus}
            reason={outreach.outreachReason}
            at={outreach.outreachAt?.toISOString() ?? null}
            conversationId={outreach.outreachConversationId}
            hasPhone={Boolean(diagnostic.contact?.phoneE164)}
            delivery={firstMessage ? { status: firstMessage.status, failedReason: firstMessage.failedReason } : null}
          />
        ) : null
      }
    />
  );
};

export default DiagnosticoDetailPage;
