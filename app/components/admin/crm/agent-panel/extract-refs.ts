export type EntityRef = { type: string; id: string; href: string };

const isEntityRef = (value: unknown): value is EntityRef =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).type === "string" &&
  typeof (value as Record<string, unknown>).id === "string" &&
  typeof (value as Record<string, unknown>).href === "string";

/** Walks a tool's JSON output looking for `ref`/`refs`/`*Ref` fields so the UI can link out to the real record. */
export const extractRefs = (value: unknown, depth = 0, out: EntityRef[] = []): EntityRef[] => {
  if (depth > 4 || value === null || typeof value !== "object") return out;

  if (Array.isArray(value)) {
    for (const item of value) extractRefs(item, depth + 1, out);
    return out;
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isEntityRef(val) && (key === "ref" || key.endsWith("Ref"))) {
      if (!out.some((r) => r.href === val.href)) out.push(val);
    } else if (typeof val === "object") {
      extractRefs(val, depth + 1, out);
    }
  }

  return out;
};
