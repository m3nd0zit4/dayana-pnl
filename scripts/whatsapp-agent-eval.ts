/**
 * Evaluación de la asistente de WhatsApp con casos reales
 * (`lib/crm/whatsapp-agent/eval/scenarios.ts`), sin enviar nada: cada caso se
 * corre k veces en modo prueba, con un calendario de mentira, y cada respuesta
 * pasa por las reglas de Dayana (código), lo que el caso exige y el juez (un
 * modelo). El modelo no contesta igual dos veces, así que se mide:
 *
 * - pass@k: pasó al menos una de las k veces (lo puede hacer);
 * - pass^k: pasó las k veces (lo hace siempre). Lo que importa en producción.
 *
 *   GEMINI_MODEL=gemini-3.5-flash bun scripts/whatsapp-agent-eval.ts [--k 3] [--only id1,id2] [--out informe.json] [--no-judge] [--level ahorro]
 *
 * `--level`: el nivel de gasto (`spend.ts`) con el que contesta: ahorro, equilibrado, completo.
 *
 * Contra `neondb_dev` (lee la configuración, los manuales y los datos del
 * negocio; no escribe nada). Sale con error si algún caso pasa menos de 2 de 3.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async () => {
  if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");
  const k = Math.max(1, Number(arg("k") ?? 3));
  const only = arg("only")?.split(",").map((s) => s.trim());
  const useJudge = !process.argv.includes("--no-judge");
  const out = arg("out") ?? path.join(tmpdir(), `whatsapp-agent-eval-${Date.now()}.json`);

  const { prisma } = await import("@/lib/db");
  const { getWhatsAppAiConfig } = await import("@/lib/crm/whatsapp-ai-config");
  const { think } = await import("@/lib/crm/whatsapp-agent/brain");
  const { resolvePersonName } = await import("@/lib/sure-name");
  const { polishReply } = await import("@/lib/crm/whatsapp-agent/wording");
  const { withPaymentBlocks } = await import("@/lib/crm/whatsapp-agent/payment-info");
  const { alreadySaid } = await import("@/lib/crm/whatsapp-agent/repeat-guard");
  const { BREACH_HOLDING, promiseBreach } = await import("@/lib/crm/whatsapp-agent/promise-guard");
  const { setFreeCallCalendarForTests } = await import("@/lib/crm/whatsapp-agent/free-call");
  const { getDateKeyInTz, getTimeHmInTz } = await import("@/lib/datetime/zoned-time");
  const { conversationSituation, situationText } = await import("@/lib/crm/whatsapp-agent/situation");
  const { SCENARIOS } = await import("@/lib/crm/whatsapp-agent/eval/scenarios");
  const { gradeReply } = await import("@/lib/crm/whatsapp-agent/eval/graders");
  const { judgePasses, judgeReply } = await import("@/lib/crm/whatsapp-agent/eval/judge");

  // Un miércoles a las 2 p. m. de Colombia, con tres horas libres de verdad.
  const now = new Date("2026-10-14T19:00:00Z");
  const slot = (iso: string, minutes = 15) => ({
    startIso: new Date(iso).toISOString(),
    endIso: new Date(new Date(iso).getTime() + minutes * 60_000).toISOString(),
    dateKey: getDateKeyInTz(new Date(iso), "America/Bogota"),
    time: getTimeHmInTz(new Date(iso), "America/Bogota"),
  });
  // Jueves 15 (3:00 y 6:45 p. m.), viernes 16 (9:15 a. m.) y el martes 20
  // (9:00 a. m. y 3:00 p. m.) para quien solo puede los martes.
  const fakeSlots = [
    slot("2026-10-15T20:00:00Z"),
    slot("2026-10-15T23:45:00Z"),
    slot("2026-10-16T14:15:00Z"),
    slot("2026-10-20T14:00:00Z"),
    slot("2026-10-20T20:00:00Z"),
  ];
  setFreeCallCalendarForTests({ available: async () => fakeSlots });

  // Como producción (2026-10-14): flujo de venta, llamada gratis sola, pagos fuera de la web.
  const base = await getWhatsAppAiConfig();
  const config = {
    ...base,
    context: { ...base.context, v2: true },
    ...(arg("level") ? { spend: { ...base.spend, level: arg("level") as typeof base.spend.level } } : {}),
    salesFlow: { ...base.salesFlow, enabled: true },
    booking: { ...base.booking, enabled: true },
    freeCall: { ...base.freeCall, autoBook: true },
    payments: {
      sendLinks: true,
      receipts: true,
      methods: [
        { key: "bancolombia", label: "Bancolombia", when: "Pagos desde Colombia", enabled: true, details: "Bancolombia\nNombre: Prueba Uno\nTipo de cuenta: Ahorros\nN° Cuenta: 00000000001" },
        { key: "western-union", label: "Western Union – Banco Unión", when: "Pagos desde fuera de Colombia", enabled: true, details: "BANCO UNIÓN – WESTERN UNION\nNúmero de cuenta: 00000000002\nTitular: Prueba Dos" },
      ],
    },
  };

  const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.id));
  type Run = {
    outcome: string;
    reply: string;
    tools: string[];
    failed: string[];
    verdict?: Awaited<ReturnType<typeof judgeReply>>;
    pass: boolean;
  };
  const results: { id: string; origin: string; runs: Run[]; passes: number }[] = [];

  const runOnce = async (s: (typeof scenarios)[number]): Promise<Run> => {
    // Como `chatNameInfo` en run.ts: el perfil, el contacto (si lo escribió ella) y la conversación.
    const nameInfo = resolvePersonName({
      profile: s.name,
      contact: s.contactName ? { name: s.contactName, typed: true } : null,
      messages: s.transcript.map((l) => ({ from: l.direction === "INBOUND" ? "person" : l.isAutoReply ? "assistant" : "dayana", text: l.body ?? "" })),
    });
    const result = await think({
      config,
      transcript: s.transcript,
      name: s.name,
      nameInfo,
      phone: "573000000000",
      conversationId: null,
      contactId: null,
      client: s.client ?? null,
      memory: s.memory ?? null,
      timezone: "America/Bogota",
      mode: "preview",
      now,
      situation: situationText(conversationSituation(s.transcript), false),
      stage: s.stage ?? null,
      freeCall: { autoBook: !s.clientMode, personTimezone: s.personTimezone ?? null },
      clientMode: s.clientMode,
      freeEvent: s.freeEvent ?? null,
    });
    const o = result.outcome;
    // Lo que de verdad recibiría la persona (lo mismo que hace run.ts): a una
    // clienta, solo pagos; nada más la calla (ni una crisis: recibe apoyo); una escalada lleva un
    // aviso corto.
    const paymentAnswer = Boolean(result.receipt) || result.paymentBlocks.details.length > 0 || Boolean(result.paymentBlocks.link);
    const silentClient = Boolean(s.clientMode) && (o?.kind === "escalate" || !paymentAnswer);
    // Le respondía a Dayana y la IA decidió no escribir nada (no_reply, como run.ts).
    const quiet = Boolean(result.noReply) && !(o?.kind === "reply" && o.message.trim()) && !paymentAnswer;
    // El mismo aviso de recibido por el mismo comprobante no sale dos veces (run.ts).
    const lastOut = [...s.transcript].reverse().find((l) => l.direction === "OUTBOUND")?.body ?? null;
    const repeatedReceipt =
      o?.kind === "reply" &&
      Boolean(result.receipt) &&
      !result.paymentBlocks.details.length &&
      !result.paymentBlocks.link &&
      !result.linkBlocks.length &&
      alreadySaid(polishReply(o.message), [lastOut]);
    // El freno de promesas de run.ts: horas que no dio la agenda, una cita que
    // no existe, «hoy mismo». Si salta, la persona recibe el aviso corto.
    const backing = [
      ...(s.backing ?? []),
      // Lo que Dayana misma escribió (sus horas también valen).
      ...s.transcript.filter((l) => l.direction === "OUTBOUND" && !l.isAutoReply && l.body).map((l) => l.body as string),
      // Como run.ts: las horas de la agenda (offer_free_call_slots / check_availability).
      ...result.toolCalls.flatMap((t) => {
        const out = (t.output ?? {}) as { options?: { label?: unknown }[]; label?: unknown };
        const fromAgenda = t.tool === "offer_free_call_slots" || t.tool === "check_availability";
        return [
          ...(fromAgenda && Array.isArray(out.options) ? out.options.map((x) => (typeof x.label === "string" ? x.label : "")) : []),
          typeof out.label === "string" ? out.label : "",
        ];
      }),
    ].filter(Boolean);
    const booked =
      Boolean(s.hasBooking) ||
      result.toolCalls.some((t) => t.tool === "book_free_call" && ["booked", "alreadyBooked", "simulated"].some((k) => (t.output as Record<string, unknown> | undefined)?.[k] === true));
    // Agendó y después escaló: run.ts le manda la confirmación del código (sin aviso de espera).
    const draft = o?.kind === "reply" ? polishReply(o.message) : polishReply(result.bookingNotice?.text ?? (result.holdingReply?.trim() || "Déjame consultarlo con Dayana y te confirmo por aquí."));
    const breach = promiseBreach({ text: draft, backing, hasBooking: booked, bookingToday: false });
    const sent: string | null = silentClient || repeatedReceipt || quiet
      ? null
      : breach
        ? BREACH_HOLDING[breach.breach]
        : o?.kind === "reply"
          ? withPaymentBlocks(draft, { ...result.paymentBlocks, links: result.linkBlocks })
          : draft;
    const reply = sent ?? (quiet ? "(no le escribe: le está respondiendo a Dayana y no hace falta contestar)" : "(no le escribe: se lo pasa a Dayana)");
    // Las reglas se miran sobre lo que escribió el modelo (antes del freno): si
    // el freno lo tapa, el prompt igual falló y tiene que verse.
    const written = silentClient || repeatedReceipt || quiet ? null : o?.kind === "reply" ? withPaymentBlocks(draft, { ...result.paymentBlocks, links: result.linkBlocks }) : draft;
    const tools = result.toolCalls.map((c) => c.tool);
    const failed: string[] = [];
    if (written) {
      for (const g of gradeReply({
        reply: written,
        transcript: s.transcript,
        tools: result.toolCalls,
        paymentBlocks: [...result.paymentBlocks.details, ...result.linkBlocks],
        gender: s.gender,
        profileName: s.name,
        backing,
        hasBooking: booked,
      })) {
        if (!g.pass) failed.push(`regla:${g.id}${g.detail ? ` («${g.detail}»)` : ""}`);
      }
    }
    const e = s.expect;
    const did = quiet ? "silent" : (o?.kind ?? "nada");
    if (e.outcome && did !== e.outcome) failed.push(`esperaba ${e.outcome}, hizo ${did}`);
    if (e.silentAlert && result.silentEscalation?.severity !== e.silentAlert) failed.push(`esperaba un aviso ${e.silentAlert} a Dayana que la persona no ve`);
    if (e.escalationCategory && !(o?.kind === "escalate" && o.category === e.escalationCategory)) {
      failed.push(`esperaba escalar como ${e.escalationCategory}`);
    }
    if (e.anyTool && !e.anyTool.some((t) => tools.includes(t))) failed.push(`no usó ${e.anyTool.join(" ni ")}`);
    for (const t of e.noTool ?? []) if (tools.includes(t)) failed.push(`usó ${t}`);
    for (const re of e.mustMatch ?? []) if (!re.test(reply)) failed.push(`falta ${re}`);
    for (const re of e.mustNotMatch ?? []) if (re.test(written ?? reply)) failed.push(`no debía decir ${re}`);
    if (breach && sent) failed.push(`freno: ${breach.breach} («${breach.detail}»)`);

    let verdict: Run["verdict"];
    if (useJudge) {
      verdict = await judgeReply({ transcript: s.transcript, reply, outcome: did, goal: s.goal, name: s.name, nameInfo }).catch(() => undefined);
      if (!verdict) failed.push("juez: no respondió");
      else if (!judgePasses(verdict)) failed.push(`juez: ${verdict.problemas.join(" · ") || "objetivo no cumplido"}`);
    }
    return { outcome: did, reply, tools, failed, verdict, pass: failed.length === 0 };
  };

  for (const s of scenarios) {
    const runs: Run[] = [];
    for (let i = 0; i < k; i++) {
      runs.push(
        await runOnce(s).catch((err: unknown) => ({
          outcome: "error",
          reply: "",
          tools: [],
          failed: [`error: ${err instanceof Error ? err.message : String(err)}`],
          pass: false,
        }))
      );
    }
    const passes = runs.filter((r) => r.pass).length;
    results.push({ id: s.id, origin: s.origin, runs, passes });
    console.log(`\n${passes === k ? "✅" : passes > 0 ? "🟡" : "❌"} ${s.id}  ${passes}/${k}   (${s.origin})`);
    for (const [i, r] of runs.entries()) {
      const v = r.verdict ? ` [R${r.verdict.responde} C${r.verdict.coherente} T${r.verdict.tono} P${r.verdict.paso}]` : "";
      console.log(`   ${r.pass ? "·" : "✗"} #${i + 1} ${r.outcome}${r.tools.length ? ` (${r.tools.join(", ")})` : ""}${v}: ${r.reply.replace(/\n+/g, " ⏎ ").slice(0, 220)}`);
      for (const f of r.failed) console.log(`        ↳ ${f}`);
    }
  }

  const passAtK = results.filter((r) => r.passes > 0).length;
  const passHatK = results.filter((r) => r.passes === k).length;
  const runsOk = results.reduce((n, r) => n + r.passes, 0);
  const ruleFails = new Map<string, number>();
  for (const r of results) for (const run of r.runs) for (const f of run.failed) {
    const key = f.startsWith("regla:") ? f.split(" ")[0] : f.startsWith("juez:") ? "juez" : "lo que pide el caso";
    ruleFails.set(key, (ruleFails.get(key) ?? 0) + 1);
  }
  console.log(`\nCasos: ${results.length} · pass@${k}: ${passAtK}/${results.length} · pass^${k}: ${passHatK}/${results.length} · respuestas buenas: ${runsOk}/${results.length * k}`);
  if (ruleFails.size) console.log(`Fallos por tipo: ${[...ruleFails].map(([key, n]) => `${key} ${n}`).join(" · ")}`);
  writeFileSync(out, JSON.stringify({ k, judge: useJudge, results }, null, 2));
  console.log(`Informe: ${out}`);

  setFreeCallCalendarForTests({});
  await prisma.$disconnect();
  const minimum = Math.ceil((k * 2) / 3);
  if (results.some((r) => r.passes < minimum)) process.exit(1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
