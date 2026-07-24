export type EntityRef = { type: string; id: string; href: string; label?: string };

const isEntityRef = (value: unknown): value is EntityRef =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).type === "string" &&
  typeof (value as Record<string, unknown>).id === "string" &&
  typeof (value as Record<string, unknown>).href === "string";

/** For a `xRef` key, look for a sibling human-readable name on the same parent object (e.g. `contactRef` + `contactName`). Falls back to generic `displayName`/`title`/`name`. */
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

/** Walks a tool's JSON output looking for `ref`/`refs`/`*Ref` fields so the UI can link out to the real record. */
export const extractRefs = (value: unknown, depth = 0, out: EntityRef[] = []): EntityRef[] => {
  if (depth > 4 || value === null || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (const item of value) extractRefs(item, depth + 1, out);
    return out;
  }

  const parent = value as Record<string, unknown>;
  for (const [key, val] of Object.entries(parent)) {
    if (isEntityRef(val) && (key === "ref" || key.endsWith("Ref"))) {
      if (!out.some((r) => r.href === val.href)) {
        const label = findSiblingLabel(key, parent);
        out.push(label ? { ...val, label } : val);
      }
    } else if (typeof val === "object") {
      extractRefs(val, depth + 1, out);
    }
  }

  return out;
};
