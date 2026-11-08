import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

const CONNECTION_CLOSED_MARKERS = [
  "Error in PostgreSQL connection",
  "Connection terminated",
  "Client has encountered a connection error",
  "Connection reset by peer",
  "Can't reach database server",
  "connection: Closed",
  "kind: Closed",
  "Connection closed",
  "ECONNRESET",
  "ETIMEDOUT",
  "Socket closed",
  "socket hang up",
] as const;

type PrismaExtended = ReturnType<typeof buildPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaExtended | undefined;
};

/** WebSocket requerido por @neondatabase/serverless en runtime Node (dev + Vercel Node). */
if (typeof window === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

/**
 * The Neon WebSocket rejects with a DOM-style `ErrorEvent` (not an `Error`):
 * `String(event)` is «[object Object]», so «socket hang up» was never seen as
 * a dropped connection and the query failed instead of reconnecting (8-nov:
 * an assistant thread PUT failed and the function exited).
 */
const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; error?: unknown };
    const inner = e.error instanceof Error ? e.error.message : "";
    return [typeof e.message === "string" ? e.message : "", inner].filter(Boolean).join(" ") || String(error);
  }
  return String(error);
};

function isConnectionClosedError(error: unknown): boolean {
  const message = errorText(error);
  return CONNECTION_CLOSED_MARKERS.some((marker) => message.includes(marker));
}

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

function createBaseClient(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: getConnectionString() });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
}

async function reconnectBase(base: PrismaClient): Promise<void> {
  await base.$disconnect().catch(() => undefined);
  await base.$connect();
}

function buildPrismaClient() {
  const base = createBaseClient();

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const maxAttempts = 3;
        let lastError: unknown;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            lastError = error;
            if (!isConnectionClosedError(error) || attempt >= maxAttempts - 1) {
              throw error;
            }
            await reconnectBase(base);
          }
        }

        throw lastError;
      },
    },
  });
}

function getPrismaClient(): PrismaExtended {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = buildPrismaClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Lazy singleton: no conecta a Neon al importar el módulo (necesario para
 * `next build` en Vercel cuando DATABASE_URL aún no está en el entorno de build).
 */
export const prisma = new Proxy({} as PrismaExtended, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client as object, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
