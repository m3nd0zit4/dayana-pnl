/**
 * Links and names pulled out of tool results. Pure.
 */

export type EntityRef = { type: string; id: string; href: string; label?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEntityRef = (value: unknown): value is EntityRef =>
  isRecord(value) &&
  typeof value.type === "string" &&
  typeof value.id === "string" &&
  typeof value.href === "string";

/** For a `xRef` key, a sibling human-readable name on the same object (`contactRef` + `contactName`), else `displayName`/`title`/`name`. */
const findSiblingLabel = (key: string, parent: Record<string, unknown>): string | undefined => {
  const prefix = key === "ref" ? "" : key.replace(/Ref$/, "");
  const candidates = [prefix ? `${prefix}Name` : undefined, "displayName", "title", "name"].filter(
    (k): k is string => Boolean(k)
  );
  for (const candidate of candidates) {
    const value = parent[candidate];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
};

/** Walks a tool's JSON output for `ref`/`refs`/`*Ref` fields so the panel can link to the real record. */
export const extractRefs = (value: unknown, depth = 0, out: EntityRef[] = []): EntityRef[] => {
  if (depth > 4 || value === null || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (const item of value) extractRefs(item, depth + 1, out);
    return out;
  }

  for (const [key, val] of Object.entries(value)) {
    if (isEntityRef(val) && (key === "ref" || key.endsWith("Ref"))) {
      if (!out.some((r) => r.href === val.href)) {
        const label = findSiblingLabel(key, value as Record<string, unknown>);
        out.push(label ? { ...val, label } : val);
      }
    } else if (typeof val === "object") {
      extractRefs(val, depth + 1, out);
    }
  }
  return out;
};

/** Same record twice (same href) shows once; the first one with a label wins. */
export const dedupeRefs = (refs: readonly EntityRef[]): EntityRef[] => {
  const out: EntityRef[] = [];
  for (const ref of refs) {
    const index = out.findIndex((r) => r.href === ref.href);
    if (index === -1) out.push(ref);
    else if (!out[index].label && ref.label) out[index] = ref;
  }
  return out;
};

export const capList = <T>(items: readonly T[], max: number): { shown: T[]; hidden: number } => ({
  shown: items.slice(0, max),
  hidden: Math.max(0, items.length - max),
});

const LABEL_KEYS = ["displayName", "fullName", "name", "title", "label", "contactName", "headline"] as const;

const labelOf = (obj: Record<string, unknown>): string | undefined => {
  for (const key of LABEL_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const first = typeof obj.firstName === "string" ? obj.firstName.trim() : "";
  const last = typeof obj.lastName === "string" ? obj.lastName.trim() : "";
  return first ? [first, last].filter(Boolean).join(" ") : undefined;
};

/**
 * id → human label for every record seen in earlier tool results (and their
 * refs), so an approval for `contactId: "cm…"` can say «Ana Pérez».
 * Also maps `slug` → title, since workshop tools take a slug.
 */
export const collectNames = (values: readonly unknown[]): Record<string, string> => {
  const names: Record<string, string> = {};
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (isEntityRef(value) && value.label && !names[value.id]) names[value.id] = value.label;
    const label = labelOf(obj);
    if (label) {
      if (typeof obj.id === "string" && !names[obj.id]) names[obj.id] = label;
      if (typeof obj.slug === "string" && !names[obj.slug]) names[obj.slug] = label;
    }
    for (const [key, val] of Object.entries(obj)) {
      if (isEntityRef(val) && (key === "ref" || key.endsWith("Ref"))) {
        const sibling = findSiblingLabel(key, obj);
        if (sibling && !names[val.id]) names[val.id] = sibling;
      }
      if (typeof val === "object") visit(val, depth + 1);
    }
  };
  for (const value of values) visit(value, 0);
  return names;
};
