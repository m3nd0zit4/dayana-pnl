/**
 * Ensures DATABASE_URL and DIRECT_URL exist before Prisma CLI runs.
 * On Vercel Preview, DIRECT_URL is sometimes omitted from Build — derive from pooler URL.
 */

export function deriveDirectUrlFromPooler(databaseUrl) {
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

export function ensurePrismaDatabaseEnv() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  let directUrl = process.env.DIRECT_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "[env] DATABASE_URL is required for build and Prisma migrations.\n" +
        "Vercel Preview (rama dev): add DATABASE_URL + DIRECT_URL (Build enabled).\n" +
        "Local: bun run env:pull · docs/dev-environment.md"
    );
  }

  if (!directUrl) {
    directUrl = deriveDirectUrlFromPooler(databaseUrl);
    process.env.DIRECT_URL = directUrl;
    console.warn(
      "[env] DIRECT_URL was missing; derived direct connection from DATABASE_URL for Prisma migrate."
    );
  }

  return { databaseUrl, directUrl };
}
