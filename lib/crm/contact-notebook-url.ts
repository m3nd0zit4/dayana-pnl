/** Canonical URL for a contact's clinical notebook (one notebook per contact). */
export type ContactNotebookUrlOptions = {
  focus?: boolean;
  /** Only when the user explicitly chooses to add a new page (e.g. toast action). */
  newPage?: boolean;
  sessionId?: string | null;
  pageId?: string | null;
};

export function contactNotebookPath(
  contactId: string,
  options: ContactNotebookUrlOptions = {}
): string {
  const params = new URLSearchParams();
  params.set("tab", "notas");
  if (options.focus) params.set("focus", "1");
  if (options.newPage) params.set("newPage", "1");
  if (options.sessionId) params.set("sessionId", options.sessionId);
  if (options.pageId) params.set("pageId", options.pageId);
  return `/admin/contacts/${contactId}?${params.toString()}`;
}

/** One-shot params (new page intent) — remove from the address bar after reading. */
export function stripEphemeralNotebookParams(params: URLSearchParams): boolean {
  let changed = false;
  for (const key of ["newPage", "sessionId"] as const) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  return changed;
}
