/**
 * Prueba en seco del asistente de WhatsApp: corre el cerebro real (modelo,
 * herramientas, datos del CRM) contra conversaciones de ejemplo, sin enviar
 * nada ni agendar de verdad (modo `preview`).
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-agent-smoke.ts
 *
 * Úsalo SOLO con la base de desarrollo (`neondb_dev`).
 */
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { think, type TranscriptLine } from "@/lib/crm/whatsapp-agent/brain";

const cases: { name: string; expect: string; transcript: TranscriptLine[] }[] = [
  {
    name: "saludo",
    expect: "reply: pregunta cómo está, sin precios",
    transcript: [{ direction: "INBOUND", body: "Hola, buenas tardes" }],
  },
  {
    name: "precio",
    expect: "reply: ofrece primero la consulta gratis",
    transcript: [{ direction: "INBOUND", body: "Hola, cuánto vale una sesión?" }],
  },
  {
    name: "cuenta",
    expect: "reply: refleja y ofrece la consulta gratis de 15 min",
    transcript: [
      { direction: "INBOUND", body: "Hola, vengo sintiéndome muy ansiosa desde que terminé con mi pareja" },
    ],
  },
  {
    name: "agendar",
    expect: "reply (check_availability)",
    transcript: [{ direction: "INBOUND", body: "Quiero agendar la consulta gratis, ¿qué horarios tienes?" }],
  },
  {
    name: "pagar",
    expect: "reply con enlace de pago (payment_link)",
    transcript: [{ direction: "INBOUND", body: "Quiero pagar el paquete de sesiones, ¿me pasas el link de pago?" }],
  },
  {
    name: "pago hecho",
    expect: "escalate payment",
    transcript: [
      { direction: "INBOUND", body: "Buenas, ya te hice la transferencia" },
      { direction: "INBOUND", body: null, attachment: "imagen" },
    ],
  },
];

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) {
    throw new Error("Solo contra la base de desarrollo (neondb_dev).");
  }
  const config = await getWhatsAppAiConfig();
  const only = process.argv[2];
  for (const c of cases) {
    if (only && c.name !== only) continue;
    const started = Date.now();
    try {
      const r = await think({
        config,
        transcript: c.transcript,
        name: "Laura",
        phone: "573001112233",
        conversationId: null,
        contactId: null,
        client: null,
        memory: null,
        timezone: "America/Bogota",
        mode: "preview",
      });
      console.log(`\n=== ${c.name} (esperado: ${c.expect}) — ${Date.now() - started} ms`);
      console.log("tools:", r.toolCalls.map((t) => t.tool).join(", ") || "(ninguna)");
      for (const t of r.toolCalls) {
        console.log(`  ${t.tool}:`, JSON.stringify(t.output).slice(0, 400));
      }
      console.log("resultado:", JSON.stringify(r.outcome, null, 2));
    } catch (e) {
      console.log(`\n=== ${c.name} FALLÓ:`, e instanceof Error ? e.message : e);
    }
  }
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
