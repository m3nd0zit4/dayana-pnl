import { prisma } from "../db";
import {
  getUsdToCopRateFromEnv,
  parseUsdToCopRate,
  USD_TO_COP_SETTING_KEY,
} from "../pricing/usd-to-cop";

export const getSiteSetting = async (key: string): Promise<string | null> => {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  return row?.value ?? null;
};

export const getSiteSettingNumber = async (
  key: string
): Promise<number | null> => {
  const raw = await getSiteSetting(key);
  if (raw == null) return null;
  return parseUsdToCopRate(raw);
};

export const setSiteSetting = async (
  key: string,
  value: string
): Promise<void> => {
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
};

export const deleteSiteSetting = async (key: string): Promise<void> => {
  await prisma.siteSetting.deleteMany({ where: { key } });
};

/** `null` = sin fila = "usa el valor de entorno". */
export const getSiteSettingBoolean = async (
  key: string
): Promise<boolean | null> => {
  const raw = await getSiteSetting(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
};

/** `value: null` borra la fila (vuelve a "automático" = entorno). */
export const setSiteSettingBoolean = async (
  key: string,
  value: boolean | null
): Promise<void> => {
  if (value == null) {
    await deleteSiteSetting(key);
    return;
  }
  await setSiteSetting(key, String(value));
};

export const getUsdToCopRateSetting = async (): Promise<number | null> =>
  getSiteSettingNumber(USD_TO_COP_SETTING_KEY);

export const setUsdToCopRateSetting = async (rate: number): Promise<void> => {
  const parsed = parseUsdToCopRate(rate);
  if (parsed == null) throw new Error("INVALID_RATE");
  await setSiteSetting(USD_TO_COP_SETTING_KEY, String(parsed));
};

/** Tasa vigente: CRM → env → 3500 COP/USD. */
export const resolveUsdToCopRate = async (): Promise<number> => {
  try {
    const fromDb = await getUsdToCopRateSetting();
    if (fromDb != null) return fromDb;
  } catch {
    /* DB no disponible */
  }
  return getUsdToCopRateFromEnv();
};
