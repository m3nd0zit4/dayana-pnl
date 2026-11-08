import {
  getContactRecents,
  mergeContactRecents,
  normalizeContactRecents,
  saveContactRecent,
  setContactRecents,
  type ContactRecentHit,
} from "@/lib/crm/contact-search-recents";

/**
 * «Recientes» of the contact search follow the staff member across devices:
 * the list lives on the server (`/api/admin/ui-state/contact-search-recents`)
 * and localStorage is the cache that renders instantly. Both sides are merged
 * by id, newest first (`mergeContactRecents`), so neither device loses an
 * entry the other added.
 */

const RECENTS_URL = "/api/admin/ui-state/contact-search-recents";
const SAVE_DEBOUNCE_MS = 600;

const fetchServerRecents = async (): Promise<ContactRecentHit[] | null> => {
  try {
    const res = await fetch(RECENTS_URL, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const { value } = (await res.json()) as { value?: unknown };
    return normalizeContactRecents(value);
  } catch {
    return null;
  }
};

const putServerRecents = async (list: readonly ContactRecentHit[]) => {
  try {
    await fetch(RECENTS_URL, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: list }),
    });
  } catch {
    // Offline: the cache keeps it and the next save or load merges it up.
  }
};

const sameIds = (a: readonly ContactRecentHit[], b: readonly ContactRecentHit[]) =>
  a.length === b.length && a.every((c, i) => c.id === b[i].id && c.usedAt === b[i].usedAt);

/**
 * The cache merged with the server's list (written back to both if they
 * differed). Resolves with the cache alone when the server can't be reached.
 */
export const loadContactRecents = async (): Promise<ContactRecentHit[]> => {
  const server = await fetchServerRecents();
  const local = getContactRecents();
  if (!server) return local;
  const merged = mergeContactRecents(local, server);
  setContactRecents(merged);
  if (!sameIds(merged, server)) await putServerRecents(merged);
  return merged;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Remembers an opened contact here at once and on the server shortly after (read-merge-write). */
export const rememberContactRecent = (contact: ContactRecentHit) => {
  saveContactRecent({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName, phoneE164: contact.phoneE164 });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void loadContactRecents();
  }, SAVE_DEBOUNCE_MS);
};

export { getContactRecents, type ContactRecentHit };
