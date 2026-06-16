/** Shared Prisma connection env helpers (build + runtime). */

export function deriveDirectUrlFromPooler(databaseUrl: string): string {
  if (!databaseUrl.includes("-pooler")) {
    return databaseUrl;
  }
  const url = new URL(databaseUrl);
  url.hostname = url.hostname.replace("-pooler", "");
  for (const key of ["pgbouncer", "connection_limit", "connect_timeout"]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

export function ensurePrismaDatabaseEnv(): {
  databaseUrl: string;
  directUrl: string;
} {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let directUrl = process.env.DIRECT_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "[env] DATABASE_URL is required.\n" +
        "Vercel Preview (dev): DATABASE_URL + DIRECT_URL (Build enabled).\n" +
        "Local: bun run env:pull · docs/dev-environment.md"
    );
  }

  if (!directUrl) {
    directUrl = deriveDirectUrlFromPooler(databaseUrl);
    process.env.DIRECT_URL = directUrl;
  }

  return { databaseUrl, directUrl };
}
