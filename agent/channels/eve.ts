import { createHash, timingSafeEqual } from "node:crypto";
import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import type { StaffUser } from "@prisma/client";
import { getStaffFromRequest } from "@/lib/auth/agent-channel-session";
import { isAgentChannelEnabled } from "@/lib/crm/agent-channels";
import { getStaffByEmail } from "@/lib/crm/staff";
import { isAgentId } from "@/agent/lib/catalog";

/**
 * Which agent the operator picked in the panel's agent menu. Only read at
 * session start (`auth.initiator`), so a thread keeps its agent; an unknown
 * value falls back to the router.
 */
const agentFrom = (request: Request) => {
  const value = request.headers.get("x-crm-agent");
  return isAgentId(value) ? value : "auto";
};

const principalFor = (staff: StaffUser, request: Request) => ({
  authenticator: "app" as const,
  principalId: staff.id,
  principalType: "user" as const,
  attributes: {
    role: staff.role,
    email: staff.email,
    displayName: staff.displayName,
    agent: agentFrom(request),
  },
});

/**
 * Phase 1: only OWNER gets the agent panel. Returning null here (rather than
 * throwing) lets eve fall through to `localDev()` in local dev and 401 in
 * production, same as the app's own API routes do via `requireOwnerStaff`.
 */
function crmStaffAuth(): AuthFn<Request> {
  return async (request) => {
    // Checked before the staff lookup so a disabled channel fails closed even
    // if the session lookup itself is slow or flaky — the toggle in
    // /admin/ajustes/canales must never depend on how auth resolves.
    if (!(await isAgentChannelEnabled("eve"))) return null;

    const staff = await getStaffFromRequest(request);
    if (!staff || staff.role !== "OWNER") return null;
    return principalFor(staff, request);
  };
}

/**
 * The eval runner (`bun run eval:agent`) talks to a local `eve dev` with a
 * bearer token instead of a browser cookie. It only exists when every one of
 * these holds, so it cannot reach production by accident:
 * - `CRM_AGENT_EVAL_TOKEN` is set (≥ 32 chars) — `lib/env.server.ts` refuses
 *   it in production;
 * - neither `NODE_ENV` nor `VERCEL_ENV` is production;
 * - the database is `neondb_dev`;
 * - `CRM_AGENT_EVAL_STAFF_EMAIL` names an active OWNER in that database.
 */
const DEV_DATABASE = "/neondb_dev";

const evalTokenEnabled = () => {
  const token = process.env.CRM_AGENT_EVAL_TOKEN?.trim() ?? "";
  if (token.length < 32) return null;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") return null;
  try {
    if (new URL(process.env.DATABASE_URL ?? "").pathname !== DEV_DATABASE) return null;
  } catch {
    return null;
  }
  return token;
};

const sameSecret = (a: string, b: string) => {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

function evalStaffAuth(token: string): AuthFn<Request> {
  return async (request) => {
    const header = request.headers.get("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!bearer || !sameSecret(bearer, token)) return null;
    const email = process.env.CRM_AGENT_EVAL_STAFF_EMAIL?.trim();
    const staff = email ? await getStaffByEmail(email) : null;
    if (!staff || !staff.isActive || staff.role !== "OWNER") return null;
    return principalFor(staff, request);
  };
}

/**
 * `localDev()` is NOT a NODE_ENV gate — it authenticates any request whose URL
 * host is loopback (or when VERCEL_ENV=development), handing out a `local-dev`
 * principal with no staff attributes. Since this channel is reached through a
 * Next rewrite (and, on Vercel, through service-to-service routing), we cannot
 * assume the host eve sees is the public one, so leaving it in the chain risks
 * an unauthenticated caller reaching the agent in a real deployment. Opt in
 * explicitly instead — fail closed when the flag is absent.
 */
const allowLocalDevAuth = process.env.CRM_AGENT_LOCAL_DEV_AUTH === "true";
const evalToken = evalTokenEnabled();

export default eveChannel({
  auth: [
    crmStaffAuth(),
    ...(evalToken ? [evalStaffAuth(evalToken)] : []),
    ...(allowLocalDevAuth ? [localDev()] : []),
  ],
});
