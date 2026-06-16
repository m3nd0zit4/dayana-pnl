export type ContactRecentHit = {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string;
};

const STORAGE_KEY = "crm-contact-search-recents";
const MAX_RECENTS = 8;

export function getContactRecents(): ContactRecentHit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ContactRecentHit =>
        !!c &&
        typeof c === "object" &&
        typeof (c as ContactRecentHit).id === "string" &&
        typeof (c as ContactRecentHit).firstName === "string" &&
        typeof (c as ContactRecentHit).phoneE164 === "string"
    );
  } catch {
    return [];
  }
}

export function saveContactRecent(contact: ContactRecentHit): void {
  if (typeof window === "undefined" || !contact.id) return;
  try {
    const prev = getContactRecents().filter((c) => c.id !== contact.id);
    const next = [contact, ...prev].slice(0, MAX_RECENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
