import { headers } from "next/headers";

const COUNTRY_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "cloudfront-viewer-country",
  "x-country-code",
] as const;

export async function getServerUserCountry(): Promise<string | null> {
  const override = process.env.FORCE_USER_COUNTRY;
  if (override) return override.toUpperCase() || null;

  const h = await headers();
  for (const key of COUNTRY_HEADERS) {
    const country = h.get(key);
    if (country && country.toUpperCase() !== "XX") {
      return country.toUpperCase();
    }
  }
  return null;
}

export function isColombiaCountry(country: string | null): boolean {
  return country === "CO";
}
