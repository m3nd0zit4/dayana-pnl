import { defineTool } from "@/lib/crm-tools/define-tool";
import { z } from "zod";
import { requireStaff } from "@/lib/crm-tools/guard";
import type { DisplayBlock } from "@/lib/crm-tools/display";
import { formatMoneyMinor } from "@/lib/crm/money";
import { getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { getContentStats } from "@/lib/crm/stats/content";
import type { BreakdownRow, MoneyKpi } from "@/lib/crm/stats/dto";
import { getFunnelStats } from "@/lib/crm/stats/funnel";
import { getPeopleStats } from "@/lib/crm/stats/people";
import { parseStatsRange } from "@/lib/crm/stats/range";
import { getSalesStats } from "@/lib/crm/stats/sales";
import type { Kpi, SeriesPoint, StatsRange } from "@/lib/crm/stats/types";
import { getWhatsAppAiConfig } from "@/lib/crm/whatsapp-ai-config";
import { freeCallService } from "@/lib/crm/whatsapp-agent/free-call";
import { salesMetrics } from "@/lib/crm/whatsapp-agent/metrics";

/**
 * The same numbers as /admin/estadisticas, for one area and one period, with
 * the comparison against the previous period of the same length. Everything
 * the model says about money comes from here — never from adding rows by hand.
 */

const pct = (share: number | null | undefined) =>
  share === null || share === undefined ? "—" : `${Math.round(share * 1000) / 10} %`;

const money = (minor: number, currency: string) => `${formatMoneyMinor(minor, currency)} ${currency}`;

const kpi = (k: Kpi) => ({ value: k.value, previous: k.previous, change: k.delta });

const moneyKpis = (rows: MoneyKpi[]) =>
  rows.map((r) => ({
    currency: r.currency,
    amount: money(r.kpi.value, r.currency),
    previous: money(r.kpi.previous, r.currency),
    change: r.kpi.delta,
  }));

const breakdown = (rows: BreakdownRow[], limit = 10) =>
  rows.slice(0, limit).map((r) => ({
    label: r.label,
    value: r.currency ? money(r.value, r.currency) : r.value,
    share: pct(r.share),
  }));

const table = (title: string, rows: BreakdownRow[], valueHeader: string, limit = 10): DisplayBlock | null =>
  rows.length === 0
    ? null
    : {
        kind: "table",
        title,
        columns: ["", valueHeader, "%"],
        rows: rows.slice(0, limit).map((r) => [r.label, r.currency ? money(r.value, r.currency) : r.value, pct(r.share)]),
        more: rows.length > limit ? rows.length - limit : undefined,
      };

const seriesChart = (
  title: string,
  points: SeriesPoint[],
  unit: Extract<DisplayBlock, { kind: "chart" }>["unit"]
): DisplayBlock | null =>
  points.length < 2 || points.every((p) => p.value === 0)
    ? null
    : { kind: "chart", chart: points.length > 20 ? "line" : "bar", title, unit, points: points.map((p) => ({ label: p.key, value: p.value })) };

const periodLabel = (range: StatsRange) => `${range.fromKey} → ${range.toKey} (${range.days} días)`;

const compact = (blocks: (DisplayBlock | null)[]) => blocks.filter((b): b is DisplayBlock => b !== null);

export default defineTool({
  description:
    "Business statistics for a period, compared with the previous period of the same length — the same numbers as /admin/estadisticas. Use it for ANY question about how much was sold, how many people, conversion, growth, best products, failed payments, webinar sign-ups, workshop seats, course progress or how the WhatsApp AI is converting. Areas: ventas (revenue by currency, net, approved payments, average ticket, failure rate and codes, refunds, by product/provider/country, promo codes, payment-link funnel), embudo (diagnostic funnel: started → completed → result → «Hablar con Dayana», purchases, by source/profile), contactos (new contacts, by source/country, marketing consent, members active/expiring, renewals, subscriptions, pipeline), contenido (free-event registrations, workshop seats sold, course completions, quizzes), whatsapp (new leads, free calls booked, AI drafts approved, reply time, calls answered/missed — always the last `days`, default 7). Money is per currency and never summed across currencies. Answer with the numbers that answer the question first, then the detail the person asked for (tables are fine); keep every figure as returned, never derive one for a period you didn't query.",
  inputSchema: z.object({
    area: z.enum(["ventas", "embudo", "contactos", "contenido", "whatsapp"]),
    period: z
      .enum(["7d", "30d", "90d", "12mo", "custom"])
      .optional()
      .describe("Default 30d. custom needs from/to."),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, with period=custom"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD inclusive, with period=custom"),
    days: z.number().int().min(1).max(90).optional().describe("Only for area=whatsapp. Default 7."),
  }),
  async execute({ area, period, from, to, days }, ctx) {
    requireStaff(ctx);

    if (area === "whatsapp") {
      const config = await getWhatsAppAiConfig();
      const m = await salesMetrics(days ?? 7, freeCallService(config).name);
      const display: DisplayBlock[] = [
        {
          kind: "kpis",
          title: `WhatsApp · últimos ${m.days} días`,
          items: [
            { label: "Personas nuevas", value: String(m.newLeads) },
            { label: "Llamadas gratis agendadas", value: String(m.freeCallsBooked) },
            { label: "Borradores aprobados", value: String(m.approvedAsIs + m.approvedEdited), hint: `${m.approvedEdited} editados` },
            {
              label: "Respuesta mediana",
              value: m.medianReplyMs === null ? "—" : `${Math.round(m.medianReplyMs / 1000)} s`,
            },
          ],
        },
      ];
      return { area, days: m.days, metrics: m, display };
    }

    const timeZone = await getOperationalTimezone();
    const range = parseStatsRange({ period: period ?? "30d", from, to }, timeZone);
    const base = { area, period: periodLabel(range), granularity: range.granularity };

    if (area === "ventas") {
      const s = await getSalesStats(range);
      const display = compact([
        {
          kind: "kpis",
          title: `Ventas · ${periodLabel(range)}`,
          items: [
            ...s.revenue.map((r) => ({ label: `Ingresos ${r.currency}`, value: money(r.kpi.value, r.currency), delta: r.kpi.delta })),
            { label: "Pagos aprobados", value: String(s.approvedCount.value), delta: s.approvedCount.delta },
            { label: "Pagos fallidos", value: pct(s.failureRate.value), hint: "del total intentado" },
          ],
        },
        seriesChart("Ingresos (equivalente USD)", s.usdEquivalentSeries, { type: "money", currency: "USD" }),
        table("Por producto", s.byProduct, "Ingresos"),
        table("Por medio de pago", s.byProvider, "Ingresos", 5),
        table("Motivos de rechazo", s.topFailureCodes, "Pagos", 5),
      ]);
      return {
        ...base,
        revenue: moneyKpis(s.revenue),
        net: moneyKpis(s.net),
        paymentsWithoutKnownFee: s.paymentsWithoutFee,
        approvedPayments: kpi(s.approvedCount),
        averageTicket: s.averageTicket.map((t) => ({
          currency: t.currency,
          amount: t.valueMinor === null ? null : money(t.valueMinor, t.currency),
        })),
        failureRate: { now: pct(s.failureRate.value), previous: pct(s.failureRate.previous) },
        topFailureCodes: breakdown(s.topFailureCodes, 5),
        refundedFromPeriod: s.refundedFromPeriod,
        byProduct: breakdown(s.byProduct),
        byProvider: breakdown(s.byProvider),
        byCountry: breakdown(s.byCountry, 8),
        promo: {
          redemptions: kpi(s.promo.redemptions),
          discount: s.promo.discountByCurrency.map((d) => money(d.minor, d.currency)),
        },
        paymentLinks: s.paymentLinks.map((st) => ({ step: st.label, count: st.count, fromPrevious: pct(st.conversionFromPrevious) })),
        usdToCopRate: s.usdToCopRate,
        display,
      };
    }

    if (area === "embudo") {
      const f = await getFunnelStats(range);
      const display = compact([
        {
          kind: "kpis",
          title: `Diagnóstico · ${periodLabel(range)}`,
          items: [
            { label: "Terminaron", value: String(f.completed.value), delta: f.completed.delta },
            { label: "Compraron", value: String(f.purchased.value), delta: f.purchased.delta, hint: `en ${f.attributionDays} días` },
          ],
        },
        f.steps.length
          ? {
              kind: "chart",
              chart: "bar",
              title: "Embudo",
              unit: { type: "count" },
              points: f.steps.map((st) => ({ label: st.label, value: st.count })),
            }
          : null,
        table("Por origen", f.bySource, "Personas"),
        table("Por perfil", f.byProfile, "Personas"),
      ]);
      return {
        ...base,
        steps: f.steps.map((st) => ({
          step: st.label,
          count: st.count,
          fromPrevious: pct(st.conversionFromPrevious),
          fromStart: pct(st.conversionFromStart),
        })),
        completed: kpi(f.completed),
        purchased: kpi(f.purchased),
        attributionDays: f.attributionDays,
        bySource: breakdown(f.bySource),
        byProfile: breakdown(f.byProfile),
        display,
      };
    }

    if (area === "contactos") {
      const p = await getPeopleStats(range);
      const display = compact([
        {
          kind: "kpis",
          title: `Personas · ${periodLabel(range)}`,
          items: [
            { label: "Contactos nuevos", value: String(p.newContacts.value), delta: p.newContacts.delta },
            { label: "Miembros activos", value: String(p.members.active), hint: `${p.members.expiringThisWeek} vencen esta semana` },
            { label: "Nuevos miembros pagos", value: String(p.newPaidMembers.value), delta: p.newPaidMembers.delta },
            { label: "Renovaciones", value: String(p.renewals.value), delta: p.renewals.delta },
          ],
        },
        seriesChart("Contactos nuevos", p.newContactsSeries, { type: "count" }),
        table("Por origen", p.contactsBySource, "Contactos"),
        table("Por país", p.contactsByCountry, "Contactos", 8),
        table("Inscripciones por estado", p.pipeline, "Inscripciones"),
      ]);
      return {
        ...base,
        newContacts: kpi(p.newContacts),
        bySource: breakdown(p.contactsBySource),
        byCountry: breakdown(p.contactsByCountry, 8),
        marketingConsentRate: pct(p.marketingConsentRate),
        members: p.members,
        newPaidMembers: kpi(p.newPaidMembers),
        renewals: kpi(p.renewals),
        subscriptionsByStatus: breakdown(p.subscriptionsByStatus),
        subscriptionsByProvider: breakdown(p.subscriptionsByProvider),
        pipeline: breakdown(p.pipeline),
        display,
      };
    }

    const c = await getContentStats(range);
    const display = compact([
      {
        kind: "kpis",
        title: `Contenido · ${periodLabel(range)}`,
        items: [
          { label: "Registros a eventos", value: String(c.webinar.registrations.value), delta: c.webinar.registrations.delta },
          { label: "Registradas que compraron", value: String(c.webinar.registrantsWhoPurchased) },
          { label: "Clases completadas", value: String(c.courses.classCompletions.value), delta: c.courses.classCompletions.delta },
        ],
      },
      table("Registros por evento", c.webinar.byEdition, "Registros"),
      c.workshops.editions.length
        ? {
            kind: "table",
            title: "Talleres",
            columns: ["Taller", "Fecha", "Cupos vendidos"],
            rows: c.workshops.editions.map((w) => [
              w.label,
              w.startsAt ? w.startsAt.slice(0, 10) : "—",
              w.capacity ? `${w.seatsSold} / ${w.capacity}` : w.seatsSold,
            ]),
          }
        : null,
    ]);
    return {
      ...base,
      webinar: {
        registrations: kpi(c.webinar.registrations),
        byEdition: breakdown(c.webinar.byEdition),
        reminderFailures: c.webinar.reminderFailures,
        registrantsWhoPurchased: c.webinar.registrantsWhoPurchased,
      },
      workshops: c.workshops.editions,
      courses: {
        classCompletions: kpi(c.courses.classCompletions),
        moduleCompletion: breakdown(c.courses.moduleCompletion),
        quizPassRate: pct(c.courses.quizPassRate),
        quizAttempts: c.courses.quizAttempts,
        comments: kpi(c.courses.comments),
      },
      display,
    };
  },
});
