import DiagnosticosPageClient, {
  type DiagnosticoRow,
} from "@/app/components/admin/crm/DiagnosticosPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { diagnosticSourceLabel } from "@/lib/crm/diagnostic-answers";
import { listCompletedDiagnostics } from "@/lib/crm/diagnostics";
import { PREVIEW_DIAGNOSTIC_ANSWERS, PREVIEW_DIAGNOSTICS } from "@/lib/crm/preview-data";
import { OBJECTION_LABEL } from "@/lib/diagnostico/profiles";

export const dynamic = "force-dynamic";

/** `orientacion` → track, para no repetir la traducción en dos sitios. */
const trackFromAnswers = (
  orientacion: unknown
): DiagnosticoRow["track"] =>
  orientacion === "pesa" ? "emocional" : orientacion === "avanzar" ? "crecimiento" : null;

/** `cierre` → frase para la fila. Se traduce aquí, en el servidor. */
const objectionFromAnswers = (cierre: unknown): string | null =>
  typeof cierre === "string" ? (OBJECTION_LABEL[cierre] ?? null) : null;

const DiagnosticosPage = async () => {
  const preview = isCrmUiPreview();
  if (preview) {
    // Track y cierre salen de las respuestas crudas de cada ejemplo, igual que
    // con una fila de verdad — no de listas paralelas emparejadas por posición,
    // que se descuadran en silencio al reordenar los ejemplos.
    const diagnosticos: DiagnosticoRow[] = PREVIEW_DIAGNOSTICS.map((d) => {
      const raw = PREVIEW_DIAGNOSTIC_ANSWERS[d.id] ?? {};
      return {
        id: d.id,
        token: d.token,
        profile: d.profile,
        urgencyScore: d.urgencyScore,
        commitmentScore: d.commitmentScore,
        recommendedProductTitle: d.recommendedProductTitle,
        source: d.source,
        sourceLabel: diagnosticSourceLabel(d.source),
        completedAt: d.completedAt,
        hasPurchased: d.isCustomer,
        whatsappLeadAt: d.whatsappLeadAt,
        whatsappStaffAt: d.whatsappStaffAt,
        contact: d.contact
          ? {
              id: d.contact.id,
              name: d.contact.name,
              email: d.contact.email,
              phoneE164: d.contact.phoneE164 ?? "",
            }
          : null,
        track: trackFromAnswers(raw.orientacion),
        objection: objectionFromAnswers(raw.cierre),
      };
    });

    return <DiagnosticosPageClient preview diagnosticos={diagnosticos} />;
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const rows = await listCompletedDiagnostics(200);

  const diagnosticos: DiagnosticoRow[] = rows.map((d) => ({
    id: d.id,
    token: d.token,
    profile: d.profile,
    urgencyScore: d.urgencyScore,
    commitmentScore: d.commitmentScore,
    recommendedProductTitle: d.recommendedProductTitle,
    source: d.source,
    sourceLabel: diagnosticSourceLabel(d.source),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    hasPurchased: d.hasPurchased,
    whatsappLeadAt: d.whatsapp.leadAt?.toISOString() ?? null,
    whatsappStaffAt: d.whatsapp.staffAt?.toISOString() ?? null,
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
    // Filas anteriores al rediseño de dos pistas no tienen `orientacion` —
    // se quedan sin track en vez de adivinar uno.
    track: trackFromAnswers(d.answers.orientacion),
    objection: objectionFromAnswers(d.answers.cierre),
  }));

  return <DiagnosticosPageClient preview={false} diagnosticos={diagnosticos} />;
};

export default DiagnosticosPage;
