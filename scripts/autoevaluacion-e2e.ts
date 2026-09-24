/**
 * Autoevaluación → WhatsApp de punta a punta, contra la base de DESARROLLO y
 * con WhatsApp en modo prueba (no sale nada). Usa Gemini de verdad.
 *
 *   GEMINI_MODEL=gemini-3.5-flash NOTIFICATIONS_DRY_RUN=true bun scripts/autoevaluacion-e2e.ts
 */
import { prisma } from "@/lib/db";
import { runDiagnosticOutreach, type DiagnosticAnalysis } from "@/lib/crm/diagnostic-outreach";
import { approveProposal } from "@/lib/crm/whatsapp-agent/approvals";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const CASES = [
  {
    phone: "+573000007721",
    firstName: "Carolina",
    answers: { orientacion: "pesa", "foco-emocional": "duelo", tiempo: "anios", modalidad: "individual", cierre: "ya" },
    completedAt: new Date("2026-09-24T08:07:00Z"), // 3:07 a. m. en Bogotá
    clientTimezone: "America/Bogota",
    ipCountry: "CO",
    ipCity: "Medellín",
    requireApproval: false,
  },
  {
    phone: "+573000007722",
    firstName: "Andrés",
    answers: { orientacion: "avanzar", "foco-crecimiento": "carrera", tiempo: "meses", modalidad: "grupo", cierre: "mes-organizando" },
    completedAt: new Date("2026-09-24T08:07:00Z"), // 10:07 a. m. en Madrid
    clientTimezone: "Europe/Madrid",
    ipCountry: "ES",
    ipCity: "Madrid",
    requireApproval: false,
  },
  {
    phone: "+573000007723",
    firstName: "Lucía",
    answers: { orientacion: "pesa", "foco-emocional": "ansiedad", tiempo: "meses", modalidad: "individual", cierre: "pronto-inseguro" },
    completedAt: new Date("2026-09-24T01:30:00Z"), // 8:30 p. m. en Lima
    clientTimezone: "America/Lima",
    ipCountry: "PE",
    ipCity: "Lima",
    requireApproval: true,
  },
];

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  await prisma.messageTemplate.upsert({
    where: { key_locale: { key: "autoevaluacion_bienvenida", locale: "es" } },
    create: {
      key: "autoevaluacion_bienvenida",
      title: "Después de la autoevaluación",
      body: "Hola {{nombre}}, te bendigo 💛 Gracias por hacer tu autoevaluación. {{mensaje}}",
      metaTemplateName: "autoevaluacion_bienvenida",
      metaTemplateLang: "es",
      metaApprovalStatus: "APPROVED",
      metaCategory: "MARKETING",
      metaBody: "Hola {{1}}, te bendigo 💛 Gracias por hacer tu autoevaluación. {{2}}",
      metaVarNames: ["nombre", "mensaje"],
    },
    update: { metaApprovalStatus: "APPROVED" },
  });
  const staff = await prisma.staffUser.findFirstOrThrow({ select: { id: true } });
  const original = await getWhatsAppAiConfig();
  let ok = true;

  for (const c of CASES) {
    await setWhatsAppAiConfig({
      ...original,
      defaultMode: "AUTO",
      diagnosticOutreach: { enabled: true, requireApproval: c.requireApproval },
    });
    const contact = await prisma.contact.upsert({
      where: { phoneE164: c.phone },
      create: { phoneE164: c.phone, firstName: c.firstName, countryIso: "CO", notifyWhatsapp: true },
      update: { notifyWhatsapp: true, firstName: c.firstName },
    });
    await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: c.phone.slice(1) } });
    const d = await prisma.diagnostic.create({
      data: {
        token: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        contactId: contact.id,
        answers: c.answers,
        profile: null,
        urgencyScore: 7,
        commitmentScore: 6,
        completedAt: c.completedAt,
        clientTimezone: c.clientTimezone,
        ipCountry: c.ipCountry,
        ipCity: c.ipCity,
        ipTimezone: c.clientTimezone,
      },
    });

    const result = await runDiagnosticOutreach(d.id);
    const again = await runDiagnosticOutreach(d.id);
    const row = await prisma.diagnostic.findUniqueOrThrow({ where: { id: d.id } });
    const a = row.aiAnalysis as DiagnosticAnalysis | null;
    console.log(`\n=== ${c.firstName} (${a?.signals.localWeekday} ${a?.signals.localTime}, ${a?.signals.livesInName})`);
    console.log("RESULT", result, "| segundo intento:", again.status);
    console.log("CARE", a?.care, "—", a?.careReason);
    console.log("FEELING", a?.feeling);
    console.log("TIME", a?.timeContext);
    console.log("MESSAGE", a?.message);

    const conv = row.outreachConversationId
      ? await prisma.conversation.findUnique({
          where: { id: row.outreachConversationId },
          include: {
            messages: { orderBy: { sentAt: "asc" } },
            aiRuns: { orderBy: { queuedAt: "desc" }, take: 1 },
          },
        })
      : null;

    if (c.requireApproval) {
      const run = conv?.aiRuns[0];
      console.log("RUN", run?.status);
      if (run?.status !== "AWAITING_APPROVAL") ok = false;
      else {
        const approved = await approveProposal({ runId: run.id, conversationId: conv!.id, staffId: staff.id });
        console.log("APPROVED →", approved.sent.slice(0, 120));
      }
    }
    const msgs = await prisma.conversationMessage.findMany({
      where: { conversationId: row.outreachConversationId ?? "-" },
      select: { body: true, source: true, isAutoReply: true },
    });
    for (const m of msgs) console.log(`  MSG [${m.source}${m.isAutoReply ? ", IA" : ""}] ${m.body}`);
    const paused = conv?.aiPausedReason;
    console.log("AI paused:", paused ?? "no");

    if (msgs.length !== 1) ok = false;
    if (again.status !== "SKIPPED") ok = false;
    if (c.firstName === "Carolina" && (a?.care === "normal" || !a?.signals.lateNight)) ok = false;
    if (c.firstName === "Andrés" && (a?.signals.localTime !== "10:07" || /mi bella|querida/i.test(a?.message ?? ""))) ok = false;
  }

  await setWhatsAppAiConfig(original);
  console.log(ok ? "\n✅ OK" : "\n❌ FALLÓ");
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
