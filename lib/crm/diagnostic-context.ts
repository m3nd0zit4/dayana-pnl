import { prisma } from "@/lib/db";
import { sanitizeAnswers } from "@/lib/diagnostico/questions";
import { buildDiagnosticSignals } from "./diagnostic-signals";
import type { DiagnosticAnalysis } from "./diagnostic-outreach";

// Aparte de diagnostic-outreach a propósito: la IA de WhatsApp lo importa en
// cada respuesta y no debe arrastrar el envío ni las aprobaciones (ciclo).

/** Para la IA de WhatsApp: lo que se sabe de la autoevaluación de esta persona. */
export const diagnosticContextFor = async (contactId: string): Promise<string | null> => {
  const d = await prisma.diagnostic.findFirst({
    where: { contactId, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { answers: true, profile: true, completedAt: true, aiAnalysis: true },
  });
  if (!d) return null;
  const a = d.aiAnalysis as DiagnosticAnalysis | null;
  const answers = buildDiagnosticSignals({
    answers: sanitizeAnswers(d.answers),
    profile: d.profile,
    urgencyScore: null,
    commitmentScore: null,
    completedAt: d.completedAt!,
    phoneCountry: null,
    contactTimezone: null,
    clientTimezone: a?.signals.timezone ?? null,
    ipCountry: null,
    ipCity: null,
    ipTimezone: null,
  }).answers;
  return [
    `Hizo la autoevaluación el ${d.completedAt!.toLocaleDateString("es-CO")}${a ? ` (${a.signals.localWeekday} ${a.signals.localTime} hora suya${a.signals.livesInName ? `, desde ${a.signals.livesInName}` : ""})` : ""}:`,
    ...answers.map((x) => `- ${x.question} → ${x.answer}`),
    a?.feeling ? `Lectura: ${a.feeling}` : "",
    a?.care && a.care !== "normal" ? `Cuidado: ${a.care} — ${a.careReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};
