export type PricingRegion = {
  name: string;
  currency: "COP" | "USD";
  provider: "MERCADO_PAGO" | "PAYPAL";
  /** ISO-3166-1 alpha-2 codes this region applies to. Empty = catch-all default. */
  countries: string[];
};

export const PRICING_REGIONS: PricingRegion[] = [
  {
    name: "Colombia",
    currency: "COP",
    provider: "MERCADO_PAGO",
    countries: ["CO"],
  },
  {
    name: "Internacional",
    currency: "USD",
    provider: "PAYPAL",
    countries: [],
  },
];

export function getPricingRegion(countryIso: string | null): PricingRegion {
  return (
    PRICING_REGIONS.find(
      (r) =>
        r.countries.length > 0 &&
        countryIso != null &&
        r.countries.includes(countryIso)
    ) ?? PRICING_REGIONS.find((r) => r.countries.length === 0)!
  );
}
