import { timingSafeEqual } from "node:crypto";

/**
 * Llamadas del reloj externo (GitHub Actions) a `/api/cron/*`: el secreto
 * `CRON_SECRET` como `Authorization: Bearer …`, comparado en tiempo constante.
 * Sin secreto configurado no pasa nadie.
 */
export const authorized = (req: Request): boolean => {
  const secret = process.env.CRON_SECRET?.trim();
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
};
