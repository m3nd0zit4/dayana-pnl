// COP is a zero-decimal currency — amountMinor already stores whole pesos
// (see CLAUDE.md). USD (and everything else) store cents, so amountMinor
// needs the usual /100 (or *100 the other way). Every payment amount
// display/parse in the CRM must go through here — a spot that unconditionally
// assumes cents produces amounts 100x off for COP.
export const isZeroDecimalCurrency = (currency: string): boolean => currency === "COP";

export const minorToMajor = (amountMinor: number, currency: string): number =>
  isZeroDecimalCurrency(currency) ? amountMinor : amountMinor / 100;

export const majorToMinor = (amount: number, currency: string): number =>
  isZeroDecimalCurrency(currency) ? Math.round(amount) : Math.round(amount * 100);

export const formatMoneyMinor = (amountMinor: number, currency: string): string => {
  const major = minorToMajor(amountMinor, currency);
  return isZeroDecimalCurrency(currency)
    ? Math.round(major).toLocaleString("es-CO")
    : major.toFixed(2);
};
