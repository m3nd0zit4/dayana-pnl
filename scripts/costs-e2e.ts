/**
 * Costos de la plataforma, de punta a punta, contra la base de DESARROLLO.
 *
 * Comprueba que:
 *
 * - una factura mensual, una anual y un cobro suelto cuentan en los meses que
 *   les tocan (y la anual, repartida en doce);
 * - los pesos se convierten con la tasa del CRM;
 * - las comisiones medidas son la suma de `payments.fee_minor` del mes más,
 *   para los pagos que no la traen, la tarifa configurada sobre lo cobrado; y
 *   se SUMAN a una factura del mismo servicio;
 * - una factura que aún no empieza se ve en el mes actual sin sumar;
 * - una factura de la IA manda sobre lo medido;
 * - editar y borrar funcionan, y borrar dos veces no rompe.
 *
 * Crea sus propias filas y las borra al terminar:
 *
 *   bun --env-file=../dayana-pnl/.env scripts/costs-e2e.ts
 */
import { prisma } from "@/lib/db";
import { parseBillInput, toUsdCents, type BillInput } from "@/lib/crm/costs/rules";
import { createBill, deleteBill, getCostsMonth, updateBill } from "@/lib/crm/costs/store";
import { paypalFee } from "@/lib/pricing/fees";

if (!process.env.DATABASE_URL?.includes("neondb_dev")) throw new Error("Solo contra neondb_dev.");

const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const TAG = `e2e-costos-${Date.now()}`;
const input = (over: Record<string, unknown>): BillInput => {
  const parsed = parseBillInput({
    serviceId: "vercel",
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

try {
  const owner = await prisma.staffUser.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (!owner) throw new Error("No hay OWNER en la base de desarrollo.");

  const before = await getCostsMonth("2026-10", NOW);
  const row = (data: typeof before, id: string) => data.services.find((s) => s.id === id);
  // Facturas de PayPal que ya hubiera en desarrollo antes de la prueba.
  const priorPaypal = row(before, "paypal");
  const priorPaypalBills = (priorPaypal?.usdCents ?? 0) - (priorPaypal?.source === "bill" ? 0 : (priorPaypal?.measured?.usdCents ?? 0));

  const monthly = await createBill(input({}), owner.id);
  const cop = await createBill(input({ serviceId: "resend", currency: "COP", amountMinor: 80_000 }), owner.id);
  const yearly = await createBill(
    input({ serviceId: "dominio", cadence: "YEARLY", amountMinor: 2400, startsOn: "2026-03-01" }),
    owner.id,
  );
  const once = await createBill(
    input({ serviceId: "otro", cadence: "ONE_TIME", amountMinor: 5000, startsOn: "2026-10-05" }),
    owner.id,
  );
  const fee = await createBill(input({ serviceId: "paypal", amountMinor: 100, startsOn: "2026-10-01" }), owner.id);
  const ai = await createBill(input({ serviceId: "gemini", amountMinor: 123_400, startsOn: "2026-10-01" }), owner.id);
  created.push(monthly.id, cop.id, yearly.id, once.id, fee.id, ai.id);

  const oct = await getCostsMonth("2026-10", NOW);
  const copUsd = toUsdCents(80_000, "COP", oct.usdToCop);
  check("las seis facturas cuentan en octubre", oct.bills.filter((b) => b.note === TAG).length === 6, oct.bills.length);
  check(
    "Vercel sube 20 USD",
    near((row(oct, "vercel")?.usdCents ?? 0) - (row(before, "vercel")?.usdCents ?? 0), 2000),
    row(oct, "vercel"),
  );
  check(
    "los pesos se convierten con la tasa del CRM",
    near((row(oct, "resend")?.usdCents ?? 0) - (row(before, "resend")?.usdCents ?? 0), copUsd),
    { usdToCop: oct.usdToCop, copUsd },
  );
  check(
    "la anual pesa una doceava parte",
    near((row(oct, "dominio")?.usdCents ?? 0) - (row(before, "dominio")?.usdCents ?? 0), 200),
    row(oct, "dominio"),
  );
  check("el cobro suelto cuenta en su mes", (row(oct, "otro")?.usdCents ?? 0) >= 5000, row(oct, "otro"));

  // Comisiones: exactamente lo que dicen los pagos de cada mes (zona de Bogotá,
  // UTC−5), y una factura del mismo servicio se suma encima.
  for (const [month, from, to] of [
    ["2026-10", "2026-10-01T05:00:00.000Z", "2026-11-01T05:00:00.000Z"],
    ["2026-11", "2026-11-01T05:00:00.000Z", "2026-12-01T05:00:00.000Z"],
  ] as const) {
    const [fees] = await prisma.$queryRaw<{ fee: bigint | null; n: bigint; no_fee: bigint; no_fee_amount: bigint | null }[]>`
      SELECT SUM("fee_minor")::bigint AS fee, COUNT(*)::bigint AS n,
             COUNT(*) FILTER (WHERE "fee_minor" IS NULL)::bigint AS no_fee,
             SUM("amount_minor") FILTER (WHERE "fee_minor" IS NULL)::bigint AS no_fee_amount
      FROM "payments"
      WHERE "status" = 'APPROVED' AND "provider" = 'PAYPAL' AND "currency" = 'USD'
        AND "paid_at" >= ${new Date(from)} AND "paid_at" < ${new Date(to)}
    `;
    const tariff = paypalFee();
    const expectedFee =
      Number(fees?.fee ?? 0) +
      Number(fees?.no_fee_amount ?? 0) * tariff.percent +
      Number(fees?.no_fee ?? 0) * tariff.fixed * 100;
    const paypal = row(await getCostsMonth(month, NOW), "paypal");
    check(
      `${month}: la comisión medida de PayPal sale de sus ${Number(fees?.n ?? 0)} pagos (${Number(fees?.no_fee ?? 0)} con tarifa)`,
      near(paypal?.measured?.usdCents ?? 0, expectedFee),
      { measured: paypal?.measured, expectedFee },
    );
    if (Number(fees?.n ?? 0) > 0) {
      check(
        `${month}: es exacta solo si todos los pagos traen su comisión`,
        paypal?.measured?.kind === (Number(fees?.no_fee ?? 0) === 0 ? "exact" : "estimate"),
        paypal?.measured,
      );
    }
    check(
      `${month}: la factura de PayPal se suma a la comisión`,
      near(paypal?.usdCents ?? 0, expectedFee + 100 + priorPaypalBills),
      paypal,
    );
  }

  const gemini = row(oct, "gemini");
  check("la factura de la IA manda sobre lo medido", gemini?.source === "bill" && (gemini?.usdCents ?? 0) >= 123_400, gemini);

  const nov = await getCostsMonth(undefined, NOW);
  check("sin mes pedido, enseña el actual", nov.month === "2026-11" && nov.currentMonth === "2026-11", nov.month);
  check("el cobro suelto de octubre no cuenta en noviembre", !nov.bills.some((b) => b.id === once.id));
  check("el mes anterior de noviembre es el total de octubre", near(nov.previousUsdCents, oct.totalUsdCents), {
    prev: nov.previousUsdCents,
    oct: oct.totalUsdCents,
  });
  check("la tendencia trae seis meses y termina en el mostrado", nov.trend.length === 6 && nov.trend[5].month === "2026-11");
  check("un mes futuro cae en el actual", (await getCostsMonth("2027-03", NOW)).month === "2026-11");

  // Una factura con la fecha en el futuro: visible en el mes actual, sin sumar.
  const future = await createBill(input({ serviceId: "mux", startsOn: "2027-11-09" }), owner.id);
  created.push(future.id);
  const withFuture = await getCostsMonth(undefined, NOW);
  const futureRow = withFuture.bills.find((b) => b.id === future.id);
  check("la que aún no empieza se ve en el mes actual", futureRow?.upcoming === true, futureRow);
  check("y no suma", near(withFuture.totalUsdCents, nov.totalUsdCents), {
    con: withFuture.totalUsdCents,
    sin: nov.totalUsdCents,
  });
  check("en un mes pasado no aparece", !(await getCostsMonth("2026-10", NOW)).bills.some((b) => b.id === future.id));

  // Cancelar: con fecha de fin deja de contar al mes siguiente.
  const ended = await updateBill(monthly.id, input({ endsOn: "2026-10-31" }));
  check("editar devuelve la factura con su fecha de fin", ended?.endsOn === "2026-10-31", ended);
  const novAfter = await getCostsMonth("2026-11", NOW);
  check("la cancelada ya no cuenta en noviembre", !novAfter.bills.some((b) => b.id === monthly.id));
  check("editar una que no existe devuelve null", (await updateBill("no-existe", input({}))) === null);

  check("borrar funciona", (await deleteBill(once.id)) === true);
  check("borrar dos veces no rompe", (await deleteBill(once.id)) === false);
} finally {
  const { count } = await prisma.platformCost.deleteMany({ where: { OR: [{ id: { in: created } }, { note: TAG }] } });
  console.log(`limpieza: ${count} filas borradas`);
  await prisma.$disconnect();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} comprobaciones fallaron:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nTodo bien.");
