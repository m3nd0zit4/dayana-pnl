/**
 * Costos de la plataforma, de punta a punta, contra la base de DESARROLLO.
 * Los proveedores (Vercel, Neon, Mux) se simulan: nada sale a internet.
 *
 * Comprueba que:
 *
 * - lo que dicen los proveedores entra en el mes que toca, con su detalle, y
 *   una clave que falta se dice y deja el total marcado como incompleto;
 * - lo guardado de un proveedor en `site_settings` se reutiliza sin volver a
 *   preguntar, y un fallo posterior enseña lo último guardado;
 * - cada respuesta de la IA suma sus tokens a `ai_usage_daily` (una fila por
 *   día y modelo) y eso es lo que cuesta la IA ese mes;
 * - desde el primer día con registro, las respuestas de WhatsApp ya no se
 *   cuentan aparte (estarían dos veces);
 * - algo apuntado a mano cuenta en su mes, los pesos se convierten con la tasa
 *   del CRM, lo apuntado manda sobre lo calculado, y editar y borrar funcionan;
 * - algo apuntado que aún no empieza se ve en el mes actual sin sumar.
 *
 * Crea sus propias filas y las borra al terminar:
 *
 *   bun --env-file=../dayana-pnl/.env scripts/costs-e2e.ts
 */
import { prisma } from "@/lib/db";
import { recordAiUsageNow } from "@/lib/ai/usage";
import { aiCostUsd } from "@/lib/crm/costs/ai-prices";
import { autoSettingKey, collectAuto, type AutoCollection } from "@/lib/crm/costs/auto";
import type { AutoCollector } from "@/lib/crm/costs/auto/types";
import { parseBillInput, toUsdCents, type BillInput } from "@/lib/crm/costs/rules";
import { createBill, deleteBill, getCostsMonth, updateBill } from "@/lib/crm/costs/store";
import { deleteSiteSetting, getSiteSetting, setSiteSetting } from "@/lib/crm/site-settings";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const TAG = `e2e-costos-${Date.now()}`;
const MODEL = `e2e-model-${Date.now()}`;
const input = (over: Record<string, unknown>): BillInput => {
  const parsed = parseBillInput({
    serviceId: "otro",
    label: TAG,
    cadence: "MONTHLY",
    currency: "USD",
    amountMinor: 2000,
    startsOn: "2026-08-10",
    endsOn: null,
    note: TAG,
    ...over,
  });
  if (!parsed.ok) throw new Error(`entrada inválida: ${parsed.error}`);
  return parsed.data;
};

// «Ahora» fijo: el mes actual de la prueba es noviembre de 2026.
const NOW = new Date("2026-11-20T15:00:00.000Z");
const created: string[] = [];

/** Proveedores de mentira: Vercel facturó, Neon se calculó, a Mux le falta la clave. */
const AUTO: AutoCollection = {
  months: {
    "2026-10": {
      vercel: { usdCents: 2000, kind: "exact" },
      neon: { usdCents: 1343, kind: "estimate", detail: "55,8 horas de cómputo · 0,1 GB guardados" },
    },
    "2026-11": { vercel: { usdCents: 2000, kind: "exact" } },
  },
  status: {
    vercel: { state: "ok" },
    neon: { state: "ok" },
    mux: { state: "missing_key", message: "Falta pegar MUX_TOKEN_ID y MUX_TOKEN_SECRET en las variables de entorno de Vercel." },
  },
};
const costs = (month: unknown) => getCostsMonth(month, NOW, { auto: async () => AUTO });
type Costs = Awaited<ReturnType<typeof costs>>;
const row = (data: Costs, id: string) => data.services.find((s) => s.id === id);

const CACHE_KEY = autoSettingKey("twilio");

try {
  const owner = await prisma.staffUser.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (!owner) throw new Error("No hay OWNER en la base de desarrollo.");

  // ── Proveedores ───────────────────────────────────────────────────────────
  const before = await costs("2026-10");
  check("Vercel: lo facturado entra tal cual", row(before, "vercel")?.usdCents === 2000 && row(before, "vercel")?.measured?.kind === "exact", row(before, "vercel"));
  check(
    "Neon: lo calculado entra con su detalle",
    row(before, "neon")?.usdCents === 1343 && row(before, "neon")?.activity === "55,8 horas de cómputo · 0,1 GB guardados",
    row(before, "neon"),
  );
  check("Mux sin clave: se dice, sin cifra", row(before, "mux")?.status?.state === "missing_key" && row(before, "mux")?.source === "none", row(before, "mux"));
  check("lo que falta deja el total marcado como incompleto", before.pending >= 1, before.pending);
  check("PayPal y Mercado Pago no salen", !row(before, "paypal") && !row(before, "mercadopago"));
  check(
    "todo lo automático cuenta como «calculado solo»",
    near(before.autoUsdCents + before.manualUsdCents, before.totalUsdCents),
    { auto: before.autoUsdCents, manual: before.manualUsdCents, total: before.totalUsdCents },
  );

  // Lo guardado de un proveedor, con la tabla de verdad.
  let asked = 0;
  const collector = (fail: boolean): AutoCollector => ({
    id: "twilio",
    collect: async () => {
      asked++;
      return fail
        ? { state: "error", message: "No respondió." }
        : { state: "ok", months: { "2026-11": { usdCents: 777, kind: "exact" } } };
    },
  });
  const store = { get: getSiteSetting, set: setSiteSetting };
  const run = (fail: boolean, now: Date) =>
    collectAuto(["2026-10", "2026-11"], { store, now, env: {}, collectors: [collector(fail)] });
  await deleteSiteSetting(CACHE_KEY);
  await run(false, NOW);
  const cached = await run(false, new Date(NOW.getTime() + 60_000));
  check("al proveedor se le pregunta una vez; después vale lo guardado", asked === 1 && cached.months["2026-11"]?.twilio?.usdCents === 777, { asked });
  const stale = await run(true, new Date(NOW.getTime() + 7 * 3_600_000));
  check(
    "si luego falla, se enseña lo último guardado y se dice",
    asked === 2 && stale.months["2026-11"]?.twilio?.usdCents === 777 && stale.status.twilio?.state === "stale",
    stale.status,
  );

  // ── La IA ─────────────────────────────────────────────────────────────────
  const [firstLog] = await prisma.$queryRaw<{ day: Date | null }[]>`SELECT MIN("day") AS day FROM "ai_usage_daily"`;
  const novBefore = await costs("2026-11");
  const usage = { model: MODEL, inputTokens: 1_000_000, cachedTokens: 400_000, audioTokens: 0, outputTokens: 100_000 };
  const day = new Date("2026-11-12T17:00:00.000Z");
  await recordAiUsageNow(usage, day);
  await recordAiUsageNow(usage, day);
  await recordAiUsageNow({ ...usage, inputTokens: 10, cachedTokens: 0, outputTokens: 5 }, new Date("2026-11-13T02:00:00.000Z"));

  const logged = await prisma.$queryRaw<{ day: Date; calls: number; input: bigint; output: bigint }[]>`
    SELECT "day", "calls", "input_tokens" AS input, "output_tokens" AS output
    FROM "ai_usage_daily" WHERE "model" = ${MODEL} ORDER BY "day"
  `;
  check(
    "tres respuestas el mismo día de Bogotá: una fila, sumada",
    logged.length === 1 && logged[0].calls === 3 && Number(logged[0].input) === 2_000_010 && Number(logged[0].output) === 200_005,
    logged.map((r) => ({ ...r, input: Number(r.input), output: Number(r.output) })),
  );
  check("la fila es del día en la zona de Dayana (21:00 del 12, no el 13 UTC)", logged[0]?.day.toISOString().slice(0, 10) === "2026-11-12", logged[0]?.day);

  const novAfter = await costs("2026-11");
  const expectedUsd = aiCostUsd({ inputTokens: 2_000_010, cachedTokens: 800_000, audioTokens: 0, outputTokens: 200_005 }, MODEL);
  // Si este es el primer registro que hay, los días posteriores dejan de
  // contarse con las respuestas de WhatsApp; en desarrollo todas son de octubre.
  check(
    "lo que cuesta la IA sube exactamente lo anotado",
    near((row(novAfter, "gemini")?.usdCents ?? 0) - (row(novBefore, "gemini")?.usdCents ?? 0), expectedUsd * 100),
    { before: row(novBefore, "gemini")?.usdCents, after: row(novAfter, "gemini")?.usdCents, expectedUsd },
  );
  check(
    "y dice que ese modelo no tiene tarifa publicada",
    (row(novAfter, "gemini")?.activity ?? "").includes(`${MODEL} sin tarifa publicada`),
    row(novAfter, "gemini")?.activity,
  );
  if (!firstLog?.day) {
    const octRuns = await prisma.whatsAppAiRun.count({
      where: { model: { not: null }, queuedAt: { gte: new Date("2026-10-01T05:00:00.000Z"), lt: new Date("2026-11-01T05:00:00.000Z") } },
    });
    check(
      "antes del primer día con registro siguen contando las respuestas de WhatsApp",
      octRuns === 0 || (row(await costs("2026-10"), "gemini")?.activity ?? "").includes("de antes del registro completo"),
      { octRuns },
    );
  }

  // ── Lo apuntado a mano ────────────────────────────────────────────────────
  const monthly = await createBill(input({}), owner.id);
  const cop = await createBill(input({ currency: "COP", amountMinor: 80_000 }), owner.id);
  const once = await createBill(input({ cadence: "ONE_TIME", amountMinor: 5000, startsOn: "2026-10-05" }), owner.id);
  const neonBill = await createBill(input({ serviceId: "neon", amountMinor: 9900, startsOn: "2026-10-01" }), owner.id);
  created.push(monthly.id, cop.id, once.id, neonBill.id);

  const oct = await costs("2026-10");
  const copUsd = toUsdCents(80_000, "COP", oct.usdToCop);
  check("lo apuntado cuenta en su mes", oct.bills.filter((b) => b.note === TAG && !b.fixed).length === 4, oct.bills.length);
  check(
    "«Otro» suma todo lo apuntado, con los pesos convertidos a la tasa del CRM",
    near((row(oct, "otro")?.usdCents ?? 0) - (row(before, "otro")?.usdCents ?? 0), 2000 + copUsd + 5000),
    { otro: row(oct, "otro"), usdToCop: oct.usdToCop },
  );
  check(
    "lo apuntado manda sobre lo calculado (Neon), que queda de referencia",
    row(oct, "neon")?.source === "bill" && row(oct, "neon")?.usdCents === 9900 && row(oct, "neon")?.measured?.usdCents === 1343,
    row(oct, "neon"),
  );
  check(
    "lo apuntado cuenta aparte de lo calculado solo",
    near(oct.manualUsdCents - before.manualUsdCents, 2000 + copUsd + 5000 + 9900) && near(oct.autoUsdCents, before.autoUsdCents - 1343),
    { manual: oct.manualUsdCents, auto: oct.autoUsdCents },
  );

  const nov = await costs(undefined);
  check("sin mes pedido, enseña el actual", nov.month === "2026-11" && nov.currentMonth === "2026-11", nov.month);
  check("el cobro suelto de octubre no cuenta en noviembre", !nov.bills.some((b) => b.id === once.id));
  check("el mes anterior de noviembre es el total de octubre", near(nov.previousUsdCents, oct.totalUsdCents), {
    prev: nov.previousUsdCents,
    oct: oct.totalUsdCents,
  });
  check("la tendencia trae seis meses y termina en el mostrado", nov.trend.length === 6 && nov.trend[5].month === "2026-11");
  check("un mes futuro cae en el actual", (await costs("2027-03")).month === "2026-11");

  const future = await createBill(input({ startsOn: "2027-11-09" }), owner.id);
  created.push(future.id);
  const withFuture = await costs(undefined);
  const futureRow = withFuture.bills.find((b) => b.id === future.id);
  check("lo que aún no empieza se ve en el mes actual", futureRow?.upcoming === true, futureRow);
  check("y no suma", near(withFuture.totalUsdCents, nov.totalUsdCents), { con: withFuture.totalUsdCents, sin: nov.totalUsdCents });

  const ended = await updateBill(monthly.id, input({ endsOn: "2026-10-31" }));
  check("editar devuelve el gasto con su fecha de fin", ended?.endsOn === "2026-10-31", ended);
  check("lo cancelado ya no cuenta en noviembre", !(await costs("2026-11")).bills.some((b) => b.id === monthly.id));
  check("editar uno que no existe devuelve null", (await updateBill("no-existe", input({}))) === null);
  check("borrar funciona", (await deleteBill(once.id)) === true);
  check("borrar dos veces no rompe", (await deleteBill(once.id)) === false);
} finally {
  const { count } = await prisma.platformCost.deleteMany({ where: { OR: [{ id: { in: created } }, { note: TAG }] } });
  const usageRows = await prisma.$executeRaw`DELETE FROM "ai_usage_daily" WHERE "model" = ${MODEL}`;
  await deleteSiteSetting(CACHE_KEY);
  console.log(`limpieza: ${count} gastos, ${usageRows} filas de uso de la IA`);
  await prisma.$disconnect();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} comprobaciones fallaron:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTodo bien.");
