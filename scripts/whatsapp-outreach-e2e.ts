/**
 * De punta a punta: el primer mensaje a quien nunca escribió (autoevaluación)
 * y la barra de aprobación, en todos los casos. Contra la base de DESARROLLO,
 * con WhatsApp en modo prueba (no sale nada). Usa Gemini de verdad.
 *
 *   bun run e2e:whatsapp
 *
 * Lo que protege (todos fueron errores reales):
 * - «Aceptar y enviar» nunca termina en error: sin ventana ni plantilla
 *   aprobada, la propuesta se envía desde el WhatsApp de Dayana, y no se da
 *   por enviada hasta que el mensaje llega de verdad (eco del celular).
 * - México (521…) y Argentina (549…): la respuesta cae en el mismo chat.
 * - Un chat sin mensajes no aparece como «📎 Adjunto».
 * - A quien nunca escribió no se le dice «pasaron más de 24 h».
 * - Con plantilla aprobada sale por plantilla; con ventana abierta, texto.
 * - En modo IA sin plantilla no falla: queda el borrador y el aviso.
 * - Las plantillas recomendadas cumplen las reglas de Meta.
 */
import { prisma } from "@/lib/db";
import { runDiagnosticOutreach } from "@/lib/crm/diagnostic-outreach";
import { ApprovalError, approveByPhone, approveProposal } from "@/lib/crm/whatsapp-agent/approvals";
import { getChat, listChats } from "@/lib/crm/whatsapp-agent/workspace";
import { getWhatsAppAiConfig, setWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { STARTER_TEMPLATES, templateBodyProblem } from "@/lib/crm/whatsapp-templates";
import { saveWhatsAppProvider } from "@/lib/meta/whatsapp-provider";
import { whatsAppDigits } from "@/lib/whatsapp-contact";
import { resendFailedMessage, resendSource } from "@/lib/crm/whatsapp-resend";
import { processNormalizedEvent } from "@/lib/meta/ingest";
import type { NormalizedMessage } from "@/lib/meta/inbound";

/** Un mensaje que llega por el webhook (de la persona, o eco del celular de Dayana). */
const webhookMessage = (threadId: string, body: string, isEcho: boolean): NormalizedMessage => ({
  kind: "message",
  channel: "WHATSAPP",
  metaAccountId: "test-phone-id",
  threadId,
  externalMessageId: `wamid.e2e.${isEcho ? "echo" : "in"}.${Date.now()}.${Math.random().toString(36).slice(2)}`,
  isEcho,
  body,
  attachments: [],
  replyToExternalId: null,
  sentAt: new Date(),
  participantName: isEcho ? null : "Persona de prueba",
});

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
process.env.NOTIFICATIONS_DRY_RUN = "true";
process.env.GEMINI_MODEL ||= "gemini-3.5-flash";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${!ok && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
  if (!ok) failures.push(name);
};

const OUTREACH_KEYS = ["autoevaluacion_bienvenida", "seguimiento_diagnostico"];

const setTemplatesApproved = async (approved: boolean) => {
  for (const key of OUTREACH_KEYS) {
    const starter = STARTER_TEMPLATES.find((t) => t.key === key)!;
    const numbered = starter.body.replace(/\{\{(\w+)\}\}/g, () => "{{n}}");
    const varNames = [...starter.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    await prisma.messageTemplate.upsert({
      where: { key_locale: { key, locale: "es" } },
      create: {
        key,
        title: starter.title,
        body: starter.body,
        metaTemplateName: key,
        metaTemplateLang: "es",
        metaApprovalStatus: approved ? "APPROVED" : "PENDING",
        metaCategory: starter.category,
        metaBody: numbered,
        metaVarNames: varNames,
      },
      update: { body: starter.body, metaApprovalStatus: approved ? "APPROVED" : "PENDING", metaVarNames: varNames },
    });
  }
};

let seq = 0;
/** Persona nueva que acaba de terminar la autoevaluación. */
const newPerson = async (
  firstName: string,
  opts: { wroteHoursAgo?: number; aiMode?: "AUTO" | "COPILOT"; phone?: string } = {}
) => {
  seq++;
  const phone = opts.phone ?? `+5730000079${String(seq).padStart(2, "0")}`;
  const digits = phone.slice(1);
  await prisma.conversation.deleteMany({
    where: { channel: "WHATSAPP", externalThreadId: { in: [digits, whatsAppDigits(phone)] } },
  });
  await prisma.conversation.deleteMany({ where: { channel: "WHATSAPP", externalThreadId: digits } });
  const contact = await prisma.contact.upsert({
    where: { phoneE164: phone },
    create: { phoneE164: phone, firstName, countryIso: "CO", notifyWhatsapp: true },
    update: { firstName, notifyWhatsapp: true },
  });
  if (opts.wroteHoursAgo !== undefined) {
    const at = new Date(Date.now() - opts.wroteHoursAgo * 3600_000);
    const conv = await prisma.conversation.create({
      data: {
        channel: "WHATSAPP",
        externalThreadId: digits,
        metaAccountId: "test-phone-id",
        contactId: contact.id,
        participantName: firstName,
        lastInboundAt: at,
        lastMessageAt: at,
        // Como si el interruptor general ya la hubiera puesto en ese modo.
        aiMode: opts.aiMode ?? "AUTO",
      },
    });
    await prisma.conversationMessage.create({
      data: {
        conversationId: conv.id,
        direction: "INBOUND",
        body: "Hola, quiero información",
        externalMessageId: `wamid.e2e.in.${Date.now()}.${seq}`,
        sentAt: at,
      },
    });
  }
  const diagnostic = await prisma.diagnostic.create({
    data: {
      token: `e2e-out-${Date.now()}-${seq}`,
      contactId: contact.id,
      answers: { orientacion: "avanzar", "foco-crecimiento": "relaciones", tiempo: "meses", modalidad: "grupo", cierre: "mes-organizando" },
      urgencyScore: 5,
      commitmentScore: 6,
      completedAt: new Date(),
      clientTimezone: "America/Bogota",
      ipCountry: "CO",
    },
  });
  return { contact, diagnostic, digits };
};

const main = async () => {
  await saveWhatsAppProvider({ provider: "dialog360", apiKey: "dry-run-not-a-real-key" });
  await prisma.siteSetting.upsert({
    where: { key: "whatsapp.autoreply.enabled" },
    create: { key: "whatsapp.autoreply.enabled", value: "true" },
    update: { value: "true" },
  });
  const staff = await prisma.staffUser.findFirstOrThrow({ select: { id: true } });
  const original = await getWhatsAppAiConfig();
  const setMode = (defaultMode: "AUTO" | "COPILOT") =>
    setWhatsAppAiConfig({ ...original, defaultMode, diagnosticOutreach: { enabled: true, requireApproval: false } });

  try {
    console.log("\n0. Plantillas recomendadas");
    for (const t of STARTER_TEMPLATES) check(`«${t.title}» cumple las reglas de Meta`, templateBodyProblem(t.body) === null, templateBodyProblem(t.body));

    console.log("\n1. Copiloto, nunca escribió, SIN plantilla aprobada (el error de Mario)");
    await setMode("COPILOT");
    await setTemplatesApproved(false);
    {
      const { diagnostic, digits } = await newPerson("Mario");
      const r = await runDiagnosticOutreach(diagnostic.id);
      check("queda esperando aprobación", r.status === "AWAITING_APPROVAL", r);
      const list = await listChats({ queue: "all", q: digits });
      check("la lista no dice «Adjunto»", list[0]?.lastMessage === "Mensaje por aprobar", list[0]?.lastMessage);
      const chat = (await getChat(r.conversationId!))!;
      check("sabe que nunca escribió", chat.windowState === "never", chat.windowState);
      const a = chat.approvals[0];
      check("la propuesta sale por el celular", a?.delivery === "phone", a?.delivery);
      check("trae el enlace con el mensaje", Boolean(a?.phoneUrl?.includes(digits) && a.phoneUrl.includes("text=")), a?.phoneUrl);
      let code: string | null = null;
      try {
        await approveProposal({ runId: a.runId, conversationId: chat.id, staffId: staff.id });
      } catch (e) {
        code = e instanceof ApprovalError ? e.message : `otro error: ${e instanceof Error ? e.message : e}`;
      }
      check("«Aceptar y enviar» por el CRM no intenta un envío imposible", code === "needs_phone", code);
      const byPhone = await approveByPhone({ runId: a.runId, conversationId: chat.id, staffId: staff.id });
      check("«Enviar desde el WhatsApp de Dayana» da el enlace", Boolean(byPhone.url?.startsWith("https://wa.me/")), byPhone);
      const opened = (await getChat(chat.id))!;
      check(
        "abrirlo NO la da por enviada (el caso de Mario, Ángela y Nancy)",
        opened.approvals.length === 1 && Boolean(opened.approvals[0].proposal.phoneOpenedAt),
        opened.approvals.map((x) => x.proposal.phoneOpenedAt)
      );
      await processNormalizedEvent("whatsapp_business_account", webhookMessage(chat.phone, opened.approvals[0].proposal.message, true));
      const sent = (await getChat(chat.id))!;
      check("cuando sale del celular de Dayana, la propuesta se cierra", sent.approvals.length === 0, sent.approvals.length);
      check("y el mensaje queda en el chat", sent.messages.some((m) => m.direction === "OUTBOUND"), sent.messages.length);
    }

    console.log("\n2. Copiloto, nunca escribió, CON plantilla aprobada");
    await setTemplatesApproved(true);
    {
      const { diagnostic } = await newPerson("Ángela");
      const r = await runDiagnosticOutreach(diagnostic.id);
      const chat = (await getChat(r.conversationId!))!;
      const a = chat.approvals[0];
      check("la propuesta sale por plantilla", a?.delivery === "template", a?.delivery);
      const res = await approveProposal({ runId: a.runId, conversationId: chat.id, staffId: staff.id }).catch((e) => e);
      check("«Aceptar y enviar» envía", !(res instanceof Error), res instanceof Error ? res.message : null);
      const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: chat.id } });
      check("queda un mensaje enviado en el chat", msgs.length === 1 && msgs[0].direction === "OUTBOUND", msgs.length);
      check("el texto de la plantilla no termina en variable", !/\{\{/.test(msgs[0]?.body ?? ""), msgs[0]?.body);
    }

    console.log("\n3. Copiloto, escribió hace 2 h (ventana abierta)");
    await setTemplatesApproved(false);
    {
      const { diagnostic } = await newPerson("Laura", { wroteHoursAgo: 2, aiMode: "COPILOT" });
      const r = await runDiagnosticOutreach(diagnostic.id);
      const chat = (await getChat(r.conversationId!))!;
      check("ventana abierta", chat.windowState === "open", chat.windowState);
      const a = chat.approvals[0];
      check("la propuesta va como texto normal", a?.delivery === "text", a?.delivery);
      if (!a) throw new Error("sin propuesta");
      const res = await approveProposal({ runId: a.runId, conversationId: chat.id, staffId: staff.id }).catch((e) => e);
      check("se envía sin plantilla", !(res instanceof Error), res instanceof Error ? res.message : null);
    }

    console.log("\n4. Copiloto, escribió hace 3 días, sin plantilla");
    {
      const { diagnostic } = await newPerson("Pedro", { wroteHoursAgo: 72, aiMode: "COPILOT" });
      const r = await runDiagnosticOutreach(diagnostic.id);
      const chat = (await getChat(r.conversationId!))!;
      check("ventana cerrada (no «nunca»)", chat.windowState === "closed", chat.windowState);
      check("sale por el celular", chat.approvals[0]?.delivery === "phone", chat.approvals[0]?.delivery);
    }

    console.log("\n4b. México y Argentina: la respuesta cae en el mismo chat");
    await setMode("COPILOT");
    for (const [label, phone, expected] of [
      ["México", "+529990001122", "5219990001122"],
      ["Argentina", "+542990001122", "5492990001122"],
    ] as const) {
      const { diagnostic } = await newPerson(`Prueba ${label}`, { phone });
      const r = await runDiagnosticOutreach(diagnostic.id);
      const conv = await prisma.conversation.findUnique({ where: { id: r.conversationId! } });
      check(`${label}: el chat usa el número de WhatsApp (${expected})`, conv?.externalThreadId === expected, conv?.externalThreadId);
      await processNormalizedEvent("whatsapp_business_account", webhookMessage(expected, "Hola, sí quiero la consulta", false));
      const chats = await prisma.conversation.count({ where: { channel: "WHATSAPP", externalThreadId: { in: [phone.slice(1), expected] } } });
      check(`${label}: su respuesta no crea otro chat`, chats === 1, chats);
      const chat = (await getChat(r.conversationId!))!;
      check(`${label}: se abre la ventana de 24 h`, chat.windowState === "open", chat.windowState);
    }

    console.log("\n4c. Mensaje que WhatsApp no entregó: «Reenviar»");
    for (const [label, hours, expected] of [
      ["ventana abierta", 1, "sent"],
      ["ventana cerrada, sin plantilla", 48, "phone"],
    ] as const) {
      const { contact } = await newPerson(`Reenvío ${label}`, { wroteHoursAgo: hours, aiMode: "COPILOT" });
      const conv = await prisma.conversation.findFirstOrThrow({ where: { contactId: contact.id, channel: "WHATSAPP" } });
      const failed = await prisma.conversationMessage.create({
        data: {
          conversationId: conv.id,
          direction: "OUTBOUND",
          body: "Hola, ¿cómo sigues?",
          status: "FAILED",
          failedReason: "Message undeliverable",
          externalMessageId: `wamid.e2e.failed.${Date.now()}.${seq}`,
          sentAt: new Date(),
        },
      });
      const chat = (await getChat(conv.id))!;
      const bubble = chat.messages.find((m) => m.id === failed.id);
      check(`${label}: el chat dice por qué no llegó`, bubble?.failedReason === "Message undeliverable", bubble?.failedReason);
      const r = await resendFailedMessage({ messageId: failed.id, staffId: staff.id });
      check(`${label}: «Reenviar» → ${expected}`, r.status === expected, r);
      if (expected === "sent") {
        const copy = await prisma.conversationMessage.findFirst({ where: { source: resendSource(failed.id) } });
        check(`${label}: el reenvío queda ligado al original`, Boolean(copy), copy?.id);
        const again = await resendFailedMessage({ messageId: failed.id, staffId: staff.id });
        check(`${label}: no se reenvía dos veces`, again.status === "failed", again);
      } else {
        check(`${label}: trae el enlace para el WhatsApp de Dayana`, r.status === "phone" && Boolean(r.url?.startsWith("https://wa.me/")), r);
      }
    }

    console.log("\n5. IA sola, nunca escribió, sin plantilla");
    await setMode("AUTO");
    {
      const { diagnostic } = await newPerson("Sofía");
      const r = await runDiagnosticOutreach(diagnostic.id);
      check("no falla: queda sin plantilla y avisa", r.status === "NEEDS_TEMPLATE", r);
      const chat = (await getChat(r.conversationId!))!;
      check("deja el borrador en el chat", Boolean(chat.draft?.body), chat.draft);
    }

    console.log("\n6. IA sola, nunca escribió, con plantilla");
    await setTemplatesApproved(true);
    {
      const { diagnostic } = await newPerson("Camila");
      const r = await runDiagnosticOutreach(diagnostic.id);
      check("se le escribe enseguida", r.status === "SENT", r);
      const again = await runDiagnosticOutreach(diagnostic.id);
      check("no se le escribe dos veces", again.status === "SKIPPED", again);
    }
  } finally {
    await setWhatsAppAiConfig(original);
    await setTemplatesApproved(false);
  }

  console.log(failures.length ? `\n❌ ${failures.length} fallaron:\n- ${failures.join("\n- ")}` : "\n✅ Todo OK");
  process.exit(failures.length ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
