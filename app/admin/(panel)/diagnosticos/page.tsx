import DiagnosticosPageClient, {
  type DiagnosticoRow,
} from "@/app/components/admin/crm/DiagnosticosPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { listCompletedDiagnostics } from "@/lib/crm/diagnostics";
import {
  OBJECTION_LABEL,
  WHY_DAYANA_LABEL,
} from "@/lib/diagnostico/profiles";

export const dynamic = "force-dynamic";

const DiagnosticosPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    return <DiagnosticosPageClient preview diagnosticos={[]} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const rows = await listCompletedDiagnostics(200);

  const diagnosticos: DiagnosticoRow[] = rows.map((d) => {
    const whyDayana = Array.isArray(d.answers.porqueDayana)
      ? d.answers.porqueDayana
      : [];

    return {
      id: d.id,
      token: d.token,
      profile: d.profile,
      urgencyScore: d.urgencyScore,
      commitmentScore: d.commitmentScore,
      recommendedProductId: d.recommendedProductId,
      source: d.source,
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
      hasPurchased: d.hasPurchased,
      contact: d.contact
        ? {
            id: d.contact.id,
            name: [d.contact.firstName, d.contact.lastName]
              .filter(Boolean)
              .join(" "),
            email: d.contact.email,
            phoneE164: d.contact.phoneE164,
          }
        : null,
      // Las respuestas se traducen aquí, en el servidor: el cliente no debería
      // tener que conocer los ids del cuestionario para pintar una fila.
      objection:
        typeof d.answers.freno === "string"
          ? (OBJECTION_LABEL[d.answers.freno] ?? d.answers.freno)
          : null,
      whyDayana: whyDayana.map((v) => WHY_DAYANA_LABEL[v] ?? v),
      change: typeof d.answers.cambio === "string" ? d.answers.cambio : null,
    };
  });

  return <DiagnosticosPageClient preview={false} diagnosticos={diagnosticos} />;
};

export default DiagnosticosPage;
