import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { getStaffFromRequest } from "@/lib/auth/agent-channel-session";
import { isAgentChannelEnabled } from "@/lib/crm/agent-channels";

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

    return {
      authenticator: "app",
      principalId: staff.id,
      principalType: "user",
      attributes: {
        role: staff.role,
        email: staff.email,
        displayName: staff.displayName,
      },
    };
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

export default eveChannel({
  auth: allowLocalDevAuth ? [crmStaffAuth(), localDev()] : [crmStaffAuth()],
});
