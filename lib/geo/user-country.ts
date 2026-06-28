import { headers } from "next/headers";

export async function getServerUserCountry(): Promise<string | null> {
  const override = process.env.FORCE_USER_COUNTRY;
  if (override) return override.toUpperCase() || null;

  const h = await headers();
  const country = h.get("x-vercel-ip-country");
  if (!country || country === "XX") return null;
  return country.toUpperCase();
}

export function isColombiaCountry(country: string | null): boolean {
  return country === "CO";
}
