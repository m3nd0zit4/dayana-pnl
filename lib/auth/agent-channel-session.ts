import { getToken } from "next-auth/jwt";
import type { StaffUser } from "@prisma/client";
import { getStaffById } from "@/lib/crm/staff";
import { validateStaffSession } from "@/lib/auth/staff-sessions";

/**
 * Decodes the staff session cookie directly via `next-auth/jwt` instead of
 * importing `@/auth` (NextAuth's full config). The eve agent's channel code
 * runs in eve's own dev/build process, which — unlike Next.js's bundler —
 * doesn't resolve `next-auth`'s internal `next/server` import, so pulling in
 * the whole NextAuth() factory here breaks `eve dev`/`eve build`. Mirrors the
 * cookie name convention and session-row validation from `auth.ts`/
 * `lib/auth/staff-session.ts`.
 */
export const getStaffFromRequest = async (request: Request): Promise<StaffUser | null> => {
  const secret =
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? "dev-only-auth-secret-replace-in-env" : undefined);
  if (!secret) return null;

  const isProd = process.env.NODE_ENV === "production";
  const cookieName = isProd ? "__Secure-authjs.session-token" : "authjs.session-token";

  const token = await getToken({ req: request, secret, cookieName, secureCookie: isProd });
  if (!token || token.kind !== "staff") return null;

  const staffId = token.staffId as string | undefined;
  const sessionId = token.sessionId as string | undefined;
  if (!staffId || !sessionId) return null;

  const row = await validateStaffSession(sessionId);
  if (!row) return null;

  const staff = await getStaffById(staffId);
  if (!staff || !staff.isActive) return null;

  return staff;
};
