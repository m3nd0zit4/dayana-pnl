const STORAGE_KEY = "dayana:checkout-contact-v1";

export type StoredCheckoutContact = {
  email: string;
  phone: string;
  phoneCountry: string;
  firstName?: string;
  lastName?: string;
};

export const readStoredCheckoutContact = (): StoredCheckoutContact | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCheckoutContact;
    if (!parsed.email?.trim() || !parsed.phone?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const writeStoredCheckoutContact = (value: StoredCheckoutContact): void => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
};
