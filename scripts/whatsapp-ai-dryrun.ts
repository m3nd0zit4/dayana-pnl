/**
 * Prueba en seco de la IA de WhatsApp (modo preview: no envía ni agenda).
 * Corre conversaciones simuladas y revisa las reglas de Dayana: sin precios,
 * sin frases hechas, sin repetir «mi hermosa» ni el corazón, pregunta el país.
 *
 *   bun scripts/whatsapp-ai-dryrun.ts   (solo contra neondb_dev; usa Gemini)
 */
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { think, type TranscriptLine } from "@/lib/crm/whatsapp-agent/brain";
import { mentionsPrice } from "@/lib/crm/whatsapp-agent/price-guard";
import { polishReply } from "@/lib/crm/whatsapp-agent/wording";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const BANNED = /qu[eé] te trae por|qu[eé] alegr[ií]a tenerte|algo m[aá]s en (lo )?que te pueda ayudar|\bde nada\b/i;

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const inbound = (body: string): TranscriptLine => ({ direction: "INBOUND", body, sentAt: new Date() });
const ai = (body: string): TranscriptLine => ({ direction: "OUTBOUND", body, isAutoReply: true, sentAt: new Date() });

const run = async (label: string, phone: string, name: string, transcript: TranscriptLine[]) => {
  const config = await getWhatsAppAiConfig();
  const result = await think({
    config,
    transcript,
    name,
    phone,
    conversationId: null,
    contactId: null,
    client: null,
    memory: null,
    timezone: "America/Bogota",
    mode: "preview",
  });
  const recent = transcript.filter((m) => m.direction === "OUTBOUND" && m.body).map((m) => m.body as string);
  const text = result.outcome.kind === "reply" ? polishReply(result.outcome.message, recent) : `[escala: ${result.outcome.kind}]`;
  const tools = result.toolCalls.map((t) => t.tool);
  console.log(`\n— ${label}\n  IA: ${text.replace(/\n/g, " / ")}\n  herramientas: ${tools.join(", ") || "ninguna"}`);
  check("sin precios", !mentionsPrice(text), text);
  check("sin frases hechas ni «De nada»", !BANNED.test(text), text);
  return { text, tools, result };
};

const main = async () => {
  const a = await run("Persona nueva saluda", "5216122330251", "Estefania", [inbound("Hola buenas tardes")]);
  check("abre con «Cuéntame, ¿cómo estás?»", /c[oó]mo est[aá]s/i.test(a.text), a.text);

  const b = await run("Persona nueva: ansiedad", "51916544192", "Emily", [
    inbound("Hola"),
    ai("Hola Emily, te bendigo. Cuéntame, ¿cómo estás? ¿Desde qué país me escribes?"),
    inbound("Desde Perú. Tengo mucha ansiedad y no puedo dormir"),
  ]);
  check("invita a la llamada o pregunta cuánto tiempo más", /llamada|cu[aá]nto tiempo m[aá]s/i.test(b.text), b.text);

  const c = await run("Pide el precio", "573123630948", "Mary", [
    inbound("Hola"),
    ai("Hola Mary, te bendigo 💛 Cuéntame, ¿cómo estás?"),
    inbound("Bien. Quiero saber cuánto cuesta el paquete de 6 sesiones"),
  ]);
  check("no repite el corazón", !c.text.includes("💛"), c.text);

  const d = await run("Quiere agendar", "5216122330251", "Estefania", [
    inbound("Hola"),
    ai("Hola Estefania, te bendigo, mi hermosa. Cuéntame, ¿cómo estás?"),
    inbound("Bien, tengo ansiedad desde hace un año"),
    ai("Te entiendo. Si quieres soltarlo, podemos agendar una llamada gratuita de 15 minutos con Dayana. Dime qué día y hora te quedan bien."),
    inbound("Sí, el jueves a las 3 de la tarde"),
  ]);
  check("no repite «mi hermosa»", !/hermosa/i.test(d.text), d.text);
  const booked = d.result.bookingRequest;
  check(
    "no agenda sin saber el país (lo pregunta) o avisa con país",
    d.tools.includes("request_booking") ? Boolean(booked?.note.includes("Desde")) || /pa[ií]s/i.test(d.text) : /pa[ií]s|ciudad/i.test(d.text),
    { text: d.text, booked }
  );

  const e = await run("Agenda con país", "5216122330251", "Estefania", [
    inbound("Hola"),
    ai("Hola Estefania, te bendigo. Cuéntame, ¿cómo estás? ¿Desde qué país me escribes?"),
    inbound("Desde México, La Paz Baja California Sur. Tengo ansiedad"),
    ai("Te entiendo. Si quieres soltarlo, podemos agendar una llamada gratuita de 15 minutos con Dayana. Dime qué día y hora te quedan bien."),
    inbound("El jueves a las 3 de la tarde"),
  ]);
  check("avisa a Dayana con su hora y la de Colombia", Boolean(e.result.bookingRequest?.when?.includes("Colombia")), e.result.bookingRequest);

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Prueba en seco OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
