export type ContactRecentHit = {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string;
  /** When it was last opened (ISO). Entries saved before cross-device sync have none. */
  usedAt?: string;
};

const STORAGE_KEY = "crm-contact-search-recents";
export const MAX_RECENTS = 8;

/** Only well-formed entries, whatever was stored (here or on the server). */
export const normalizeContactRecents = (raw: unknown): ContactRecentHit[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is ContactRecentHit =>
      !!c &&
      typeof c === "object" &&
      typeof (c as ContactRecentHit).id === "string" &&
      typeof (c as ContactRecentHit).firstName === "string" &&
      typeof (c as ContactRecentHit).phoneE164 === "string"
  );
};

/**
 * Pure: two devices' lists as one — by id (the most recent use wins, its
 * name/phone too), newest first, at most `MAX_RECENTS`. Entries without
 * `usedAt` (saved before sync) go after dated ones, keeping their order.
 */
export const mergeContactRecents = (...lists: readonly (readonly ContactRecentHit[])[]): ContactRecentHit[] => {
  const byId = new Map<string, { hit: ContactRecentHit; order: number }>();
  let order = 0;
  for (const list of lists) {
    for (const hit of list) {
      const prev = byId.get(hit.id);
      if (!prev || (hit.usedAt ?? "") > (prev.hit.usedAt ?? "")) byId.set(hit.id, { hit, order: prev?.order ?? order });
      order += 1;
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.hit.usedAt ?? "").localeCompare(a.hit.usedAt ?? "") || a.order - b.order)
    .slice(0, MAX_RECENTS)
    .map((v) => v.hit);
};

/**
 * The browser's copy. It's a cache: `app/components/admin/crm/contact-recents-sync.ts`
 * loads and saves the list on the server so it follows the staff member
 * across devices.
 */
export function getContactRecents(): ContactRecentHit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeContactRecents(JSON.parse(raw) as unknown) : [];
  } catch {
    return [];
  }
}

export function setContactRecents(list: readonly ContactRecentHit[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    /* ignore */
  }
}

export function saveContactRecent(contact: ContactRecentHit): void {
  if (typeof window === "undefined" || !contact.id) return;
  setContactRecents(mergeContactRecents([{ ...contact, usedAt: new Date().toISOString() }], getContactRecents()));
}
