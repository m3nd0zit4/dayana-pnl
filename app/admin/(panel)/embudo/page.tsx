import EmbudoPageClient, { type FunnelGroup, type FunnelRowView } from "@/app/components/admin/crm/embudo/EmbudoPageClient";
import { isCrmUiPreview } from "@/lib/auth/preview";
import { getStaffSession } from "@/lib/auth/staff-session";
import { getCallFunnelConfig } from "@/lib/crm/call-funnel/config";
import { DEFAULT_FUNNEL_CONFIG, whenLabel } from "@/lib/crm/call-funnel/rules";
import { funnelStats, listFunnelLeads, type FunnelLeadRow } from "@/lib/crm/call-funnel/server";
import { DEFAULT_OPERATIONAL_TZ, getDateKeyInTz, getOperationalTimezone } from "@/lib/crm/operational-timezone";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Cuántos días hacia atrás se listan (lo dice la cabecera). */
const WINDOW_DAYS = 90;

const GROUPS: FunnelGroup[] = ["todas", "seguimiento", "llamada", "hablaron"];

/** `?ver=seguimiento` abre la lista ya filtrada (para enlazarla desde un aviso). */
const groupFrom = (raw: string | string[] | undefined): FunnelGroup =>
  typeof raw === "string" && (GROUPS as string[]).includes(raw) ? (raw as FunnelGroup) : "todas";

/** «hora de Colombia», que es la zona de Dayana salvo que se cambie en Ajustes. */
const tzLabelOf = (tz: string): string => (tz === DEFAULT_OPERATIONAL_TZ ? "hora de Colombia" : `hora de ${tz.replace(/_/g, " ")}`);

/**
 * Las fechas se escriben aquí, en el servidor y en la zona de Dayana: el
 * navegador no las vuelve a calcular («p. m.» y «nov.» cambian entre el ICU de
 * Node y el del navegador, y eso rompe la hidratación).
 */
const toView = (rows: FunnelLeadRow[], tz: string, now: Date): FunnelRowView[] => {
  const today = getDateKeyInTz(now, tz);
  const yesterday = getDateKeyInTz(new Date(now.getTime() - 86_400_000), tz);
  const shortDate = new Intl.DateTimeFormat("es-CO", { timeZone: tz, day: "numeric", month: "short" });
  return rows.map((r) => {
    const came = new Date(r.createdAt);
    const key = getDateKeyInTz(came, tz);
    return {
      ...r,
      callLabel: r.call ? whenLabel(r.call.startIso, tz) : null,
      cameLabel: key === today ? "hoy" : key === yesterday ? "ayer" : `el ${shortDate.format(came).replace(".", "")}`,
    };
  });
};

const settingsOf = (config: { enabled: boolean; days: number; perDay: number }) => ({
  enabled: config.enabled,
  days: config.days,
  perDay: config.perDay,
});

/**
 * «Embudo»: las personas que pidieron su llamada gratis en `/llamada`, los
 * números de cada paso y los ajustes de la página. Carga todo aquí y lo pinta
 * `EmbudoPageClient`.
 */
const EmbudoPage = async ({ searchParams }: { searchParams: Promise<{ ver?: string | string[] }> }) => {
  const { ver } = await searchParams;
  const publicUrl = `${getSiteUrl()}/llamada`;

  if (isCrmUiPreview()) {
    return (
      <EmbudoPageClient
        rows={[]}
        stats={funnelStats([])}
        config={settingsOf(DEFAULT_FUNNEL_CONFIG)}
        tzLabel={tzLabelOf(DEFAULT_OPERATIONAL_TZ)}
        windowDays={WINDOW_DAYS}
        publicUrl={publicUrl}
      />
    );
  }

  const staff = await getStaffSession();
  if (!staff) return null;

  const now = new Date();
  const [tz, config, leads] = await Promise.all([
    getOperationalTimezone(),
    getCallFunnelConfig(),
    listFunnelLeads({ sinceDays: WINDOW_DAYS, now }).catch((e: unknown) => {
      console.error("[embudo] no se pudo cargar la lista", e);
      return null;
    }),
  ]);

  return (
    <EmbudoPageClient
      rows={leads ? toView(leads, tz, now) : null}
      stats={leads ? funnelStats(leads) : null}
      config={settingsOf(config)}
      tzLabel={tzLabelOf(tz)}
      windowDays={WINDOW_DAYS}
      publicUrl={publicUrl}
      initialGroup={groupFrom(ver)}
    />
  );
};

export default EmbudoPage;
