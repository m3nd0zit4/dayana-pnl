/**
 * Ensayo del flujo de primera vez con chats REALES exportados del celular,
 * sin enviar nada y sin tocar la base de producción: para cada chat, toma los
 * primeros mensajes de la persona y le pide a la IA (modo prueba) lo que
 * contestaría en cada turno. Luego revisa lo básico del flujo.
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-replay-eval.ts <carpeta-con-txt> [máx-chats] [turnos]
 *
 * Usa la base del entorno solo para leer los DATOS del negocio (servicios,
 * talleres, ejemplos): córrelo contra `neondb_dev`. No guarda nada.
 *
 * Revisa en cada chat:
 * - nunca da precios;
 * - saluda una sola vez;
 * - pregunta de dónde escribe una sola vez;
 * - llega a invitar a la llamada gratis;
 * y muestra al lado lo que contestó Dayana de verdad, para compararlo a ojo.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const main = async () => {
  const [dir, maxChatsArg, turnsArg] = process.argv.slice(2);
  if (!dir) throw new Error("Uso: bun scripts/whatsapp-replay-eval.ts <carpeta-con-txt> [máx-chats] [turnos]");
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const maxChats = Number(maxChatsArg ?? 10);
  const turns = Number(turnsArg ?? 5);

  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { parseExportFile, detectDayanaAuthor } = await import("@/lib/crm/whatsapp-export-history");
  const { detectBatchOwner } = await import("@/lib/crm/whatsapp-export-classify");
  const { think } = await import("@/lib/crm/whatsapp-agent/brain");
  const { mentionsPrice } = await import("@/lib/crm/whatsapp-agent/price-guard");
  const { flowState } = await import("@/lib/crm/whatsapp-agent/sales-flow");
  const { conversationSituation, situationText } = await import("@/lib/crm/whatsapp-agent/situation");

  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".txt")).slice(0, maxChats);
  const parsed = files.map((f) => parseExportFile(f, readFileSync(path.join(dir, f), "utf8")));
  const owner = detectBatchOwner(parsed.map((p) => p.authors));
  const base = await getWhatsAppAiConfig();
  const config = { ...base, context: { ...base.context, v2: true }, salesFlow: { ...base.salesFlow, enabled: true } };
  const report: unknown[] = [];

  for (const [i, chat] of parsed.entries()) {
    const dayana = detectDayanaAuthor(chat.authors, { contactName: chat.contactName, override: owner }) ?? owner;
    if (!dayana || chat.authors.length > 2) continue;
    const lines = chat.messages.map((m) => ({
      direction: m.author === dayana ? ("OUTBOUND" as const) : ("INBOUND" as const),
      body: m.body,
      sentAt: m.sentAt,
    }));
    // Solo chats que empiezan por la persona (primera vez).
    if (lines[0]?.direction !== "INBOUND") continue;

    const transcript: { direction: "INBOUND" | "OUTBOUND"; body: string | null; sentAt?: Date; isAutoReply?: boolean }[] = [];
    const answers: { person: string; ai: string; dayana: string; tools: string[] }[] = [];
    let cursor = 0;
    for (let t = 0; t < turns && cursor < lines.length; t++) {
      const burst: string[] = [];
      while (cursor < lines.length && lines[cursor].direction === "INBOUND") {
        transcript.push(lines[cursor]);
        burst.push(lines[cursor].body ?? "");
        cursor++;
      }
      if (burst.length === 0) break;
      const real: string[] = [];
      while (cursor < lines.length && lines[cursor].direction === "OUTBOUND") real.push(lines[cursor++].body ?? "");

      const result = await think({
        config,
        transcript,
        name: chat.contactName || null,
        phone: "573000000000",
        conversationId: null,
        contactId: null,
        client: null,
        memory: null,
        timezone: "America/Bogota",
        mode: "preview",
        situation: situationText(conversationSituation(transcript), false),
      });
      const ai = result.outcome?.kind === "reply" ? result.outcome.message : `(${result.outcome?.kind ?? "nada"})`;
      answers.push({ person: burst.join(" / "), ai, dayana: real.join(" / "), tools: result.toolCalls.map((c) => c.tool) });
      // La conversación sigue con lo que contestó la IA (para ver si repite pasos).
      transcript.push({ direction: "OUTBOUND", body: ai, isAutoReply: true });
      // Lo que la persona dijo después de Dayana sigue en el siguiente turno.
    }

    const aiLines = answers.map((a) => ({ direction: "OUTBOUND" as const, body: a.ai }));
    const greetings = aiLines.filter((l) => /\bte bendigo\b|\bhola\b/i.test(l.body ?? "")).length;
    const countryAsks = aiLines.filter((l) => /desde qu[eé] pa[ií]s|de d[oó]nde (me )?escribes/i.test(l.body ?? "")).length;
    const state = flowState(aiLines);
    const checks = {
      sinPrecios: answers.every((a) => !mentionsPrice(a.ai)),
      saludaUnaVez: greetings <= 1,
      preguntaPaisUnaVez: countryAsks <= 1,
      invitaALaLlamada: state.invited,
    };
    console.log(`\n#${i + 1} ${chat.contactName || files[i]} — ${Object.entries(checks).map(([k, v]) => `${v ? "✅" : "❌"} ${k}`).join("  ")}`);
    for (const a of answers) {
      console.log(`   PERSONA: ${a.person.slice(0, 160)}\n   IA:      ${a.ai.slice(0, 200)}${a.tools.length ? `  [${a.tools.join(", ")}]` : ""}\n   DAYANA:  ${a.dayana.slice(0, 200) || "(no contestó)"}`);
    }
    report.push({ chat: chat.contactName || files[i], checks, answers });
  }

  const out = path.join(dir, `replay-eval-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nInforme: ${out}`);
  await prisma.$disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
