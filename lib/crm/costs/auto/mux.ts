import {
  autoGet,
  env,
  monthKeyUtc,
  monthStartUtc,
  num,
  parseJson,
  type AutoCollector,
  type AutoContext,
  type AutoMonth,
} from "./types";

/**
 * Mux: los videos de los cursos. Mux no tiene API de facturas; tiene la lista
 * de videos (cuántos minutos hay guardados) y el uso de reproducción de los
 * últimos 90 días. Con eso y la tarifa publicada (mux.com/docs/pricing/video,
 * leída el 9-nov-2026, primer tramo de volumen) se calcula lo que costaría:
 *
 *  - guardar: por minuto y mes, según resolución y calidad;
 *  - subir: una vez, solo en calidad «plus» o «premium» («basic» es gratis);
 *  - reproducir: los primeros 100.000 minutos de cada mes son gratis;
 *  - y Mux descuenta 20 USD de uso cada mes.
 *
 * Es un cálculo, no la factura: no aplica el descuento por videos que nadie
 * ve (almacenamiento en frío) ni los tramos de volumen, y un video borrado ya
 * no aparece. Mux avisa de que su factura no coincide al centavo con estos
 * datos. Usa las claves que la plataforma ya tiene (`MUX_TOKEN_ID` /
 * `MUX_TOKEN_SECRET`).
 */

const API = "https://api.mux.com/video/v1";

type Tier = "720p" | "1080p" | "1440p" | "2160p";
const STORAGE: Record<Tier, number> = { "720p": 0.0024, "1080p": 0.003, "1440p": 0.0048, "2160p": 0.0096 };
const INPUT_PLUS: Record<Tier, number> = { "720p": 0.025, "1080p": 0.03125, "1440p": 0.05, "2160p": 0.1 };
/** «premium» cuesta 1,5 veces «plus» en todo. */
const PREMIUM = 1.5;
const DELIVERY_PER_MINUTE = 0.001;
const FREE_DELIVERY_MINUTES = 100_000;
const MONTHLY_CREDIT_USD = 20;
/** El uso de reproducción solo existe para los últimos 90 días, con 12 h de retraso. */
const DELIVERY_WINDOW_MS = 89 * 24 * 3_600_000;
const DELIVERY_LAG_MS = 12 * 3_600_000;

export type MuxAsset = { minutes: number; tier: Tier; quality: string; createdAt: Date };

const tierOf = (value: unknown): Tier =>
  value === "1080p" || value === "1440p" || value === "2160p" ? value : "720p";

type RawAsset = {
  duration?: number;
  max_resolution_tier?: string;
  resolution_tier?: string;
  video_quality?: string;
  encoding_tier?: string;
  created_at?: string | number;
  status?: string;
};

/** Un video de la API a lo que hace falta para la cuenta, o null si aún no está listo. Puro. */
export const toMuxAsset = (raw: RawAsset): MuxAsset | null => {
  const created = Number(raw.created_at);
  if (raw.status !== "ready" || !Number.isFinite(raw.duration) || !Number.isFinite(created)) return null;
  const quality = raw.video_quality ?? (raw.encoding_tier === "baseline" ? "basic" : "plus");
  return {
    minutes: (raw.duration as number) / 60,
    tier: tierOf(raw.resolution_tier ?? raw.max_resolution_tier),
    quality,
    createdAt: new Date(created * 1000),
  };
};

/** La cifra de un mes a partir de los videos que existían y los minutos vistos. Puro. */
export const muxMonth = (month: string, assets: MuxAsset[], deliveredMinutes: number | null): AutoMonth | null => {
  let storedMinutes = 0;
  let usd = 0;
  for (const asset of assets) {
    const created = monthKeyUtc(asset.createdAt);
    if (created > month) continue;
    const factor = asset.quality === "premium" ? PREMIUM : 1;
    storedMinutes += asset.minutes;
    usd += asset.minutes * STORAGE[asset.tier] * factor;
    if (created === month && asset.quality !== "basic") usd += asset.minutes * INPUT_PLUS[asset.tier] * factor;
  }
  if (storedMinutes === 0 && !deliveredMinutes) return null;
  usd += Math.max(0, (deliveredMinutes ?? 0) - FREE_DELIVERY_MINUTES) * DELIVERY_PER_MINUTE;

  const billed = Math.max(0, usd - MONTHLY_CREDIT_USD);
  return {
    usdCents: billed * 100,
    kind: "estimate",
    detail:
      `${num(storedMinutes)} min guardados` +
      (deliveredMinutes != null ? ` · ${num(deliveredMinutes)} min vistos` : "") +
      (billed === 0 ? " · dentro de los 20 USD de uso que Mux regala cada mes" : ""),
  };
};

const auth = (ctx: AutoContext) => ({
  Authorization: `Basic ${Buffer.from(`${env(ctx, "MUX_TOKEN_ID")}:${env(ctx, "MUX_TOKEN_SECRET")}`).toString("base64")}`,
});

const failure = (status: number): string =>
  status === 401 || status === 403 ? "Mux rechazó las claves (MUX_TOKEN_ID / MUX_TOKEN_SECRET)." : `Mux respondió ${status}.`;

export const muxCollector: AutoCollector = {
  id: "mux",
  collect: async (months, ctx) => {
    const missing = ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"].filter((name) => !env(ctx, name));
    if (missing.length > 0) return { state: "missing_key", env: missing };

    const assets: MuxAsset[] = [];
    for (let page = 1; page <= 30; page++) {
      const res = await autoGet(ctx, `${API}/assets?limit=100&page=${page}`, auth(ctx));
      if (!res.ok) return { state: "error", message: failure(res.status) };
      const rows = parseJson<{ data?: RawAsset[] }>(res.text)?.data ?? [];
      for (const row of rows) {
        const asset = toMuxAsset(row);
        if (asset) assets.push(asset);
      }
      if (rows.length < 100) break;
    }

    const now = ctx.now.getTime();
    const result: Record<string, AutoMonth> = {};
    for (const month of months) {
      const start = monthStartUtc(month).getTime();
      const [y, m] = month.split("-").map(Number);
      const end = Math.min(Date.UTC(y, m, 1), now - DELIVERY_LAG_MS);

      // Fuera de la ventana de 90 días no hay dato de reproducción: se queda
      // en «no se sabe», que para la cuenta es cero (lo normal: bajo lo gratis).
      let delivered: number | null = null;
      if (start >= now - DELIVERY_WINDOW_MS && end > start) {
        delivered = 0;
        for (let page = 1; page <= 30; page++) {
          const res = await autoGet(
            ctx,
            `${API}/delivery-usage?timeframe[]=${Math.floor(start / 1000)}&timeframe[]=${Math.floor(end / 1000)}&limit=100&page=${page}`,
            auth(ctx),
          );
          if (!res.ok) return { state: "error", message: failure(res.status) };
          const rows = parseJson<{ data?: { delivered_seconds?: number }[] }>(res.text)?.data ?? [];
          for (const row of rows) delivered += (Number(row.delivered_seconds) || 0) / 60;
          if (rows.length < 100) break;
        }
      }

      const cost = muxMonth(month, assets, delivered);
      if (cost) result[month] = cost;
    }
    return { state: "ok", months: result };
  },
};
