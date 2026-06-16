const hits = new Map<string, { count: number; resetAt: number }>();

const getEntry = (key: string, windowMs: number, now: number) => {
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    return { count: 0, resetAt: now + windowMs };
  }
  return entry;
};

export const rateLimitPeek = (
  key: string,
  limit = 20,
  windowMs = 60_000
): { ok: boolean; remaining: number } => {
  const now = Date.now();
  const entry = getEntry(key, windowMs, now);
  if (entry.count >= limit) {
    return { ok: false, remaining: 0 };
  }
  return { ok: true, remaining: limit - entry.count };
};

export const rateLimit = (
  key: string,
  limit = 20,
  windowMs = 60_000
): { ok: boolean; remaining: number } => {
  const now = Date.now();
  const entry = getEntry(key, windowMs, now);

  if (entry.count >= limit) {
    return { ok: false, remaining: 0 };
  }

  entry.count += 1;
  hits.set(key, entry);
  return { ok: true, remaining: limit - entry.count };
};
