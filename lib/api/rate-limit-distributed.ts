import { rateLimit as rateLimitMemory } from "@/lib/api/rate-limit";

type RateLimitResult = { ok: boolean; remaining: number };

type LimiterCache = Map<
  string,
  { limit: (key: string) => Promise<{ success: boolean; remaining: number }> }
>;

let upstashReady: LimiterCache | null = null;

const getUpstashLimiter = async (limit: number, windowMs: number) => {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;

  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const cacheKey = `${limit}:${windowSec}`;

  if (!upstashReady) upstashReady = new Map();
  const cached = upstashReady.get(cacheKey);
  if (cached) return cached;

  try {
    const { Ratelimit } = await import("@upstash/ratelimit");
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url, token });
    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "dayana-pnl",
    });
    const limiter = {
      limit: async (key: string) => {
        const result = await rl.limit(key);
        return { success: result.success, remaining: result.remaining };
      },
    };
    upstashReady.set(cacheKey, limiter);
    return limiter;
  } catch {
    return null;
  }
};

/**
 * Rate limit distribuido (Upstash) con fallback en memoria para local/dev.
 */
export const rateLimitDistributed = async (
  key: string,
  limit = 20,
  windowMs = 60_000
): Promise<RateLimitResult> => {
  const upstash = await getUpstashLimiter(limit, windowMs);
  if (upstash) {
    const result = await upstash.limit(key);
    return { ok: result.success, remaining: result.remaining };
  }
  return rateLimitMemory(key, limit, windowMs);
};

/**
 * IP del cliente, para la clave del límite de peticiones.
 *
 * Detrás de un proxy (Vercel) siempre hay cabecera. En local no hay ninguna, y
 * devolver la constante `"unknown"` metía **todo** el tráfico de la máquina en
 * un mismo cubo: abrir el cuestionario once veces en un minuto agotaba el
 * límite para el navegador entero, y como el fallo era mudo la persona
 * terminaba las ocho preguntas sin resultado. En desarrollo eso no protege de
 * nada —no hay a quién limitar— y sí rompe las pruebas, así que ahí la clave
 * se hace única por petición.
 */
export const clientIp = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  if (process.env.NODE_ENV === "development") {
    return `dev:${crypto.randomUUID()}`;
  }
  return "unknown";
};
