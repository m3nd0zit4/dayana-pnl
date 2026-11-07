/**
 * Lo que de una llamada MCP va al registro de auditoría. Puro, para `bun test`.
 */

/** Claves cuyo valor nunca va al registro de auditoría. */
const SECRET_KEY = /code|otp|password|secret|token|pin/i;

/** Tools whose `code` is not a secret: the promo code itself, which the audit must show. */
const PUBLIC_CODE_TOOLS = new Set(["create_promo_code", "update_promo_code"]);
const MAX_AUDIT_STRING = 300;

/** La entrada de una llamada, apta para el registro: sin códigos y sin textos enormes. */
export const sanitizeToolInput = (value: unknown, depth = 0, tool?: string): unknown => {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length > MAX_AUDIT_STRING ? `${value.slice(0, MAX_AUDIT_STRING)}…` : value;
  }
  if (depth > 4) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeToolInput(v, depth + 1, tool));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) && !(k === "code" && tool && PUBLIC_CODE_TOOLS.has(tool)) ? "[oculto]" : sanitizeToolInput(v, depth + 1, tool),
      ])
    );
  }
  return String(value);
};
