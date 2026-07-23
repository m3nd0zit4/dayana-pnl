import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { getStaffFromRequest } from "@/lib/auth/agent-channel-session";

/**
 * Phase 1: only OWNER gets the agent panel. Returning null here (rather than
 * throwing) lets eve fall through to `localDev()` in local dev and 401 in
 * production, same as the app's own API routes do via `requireOwnerStaff`.
 */
function crmStaffAuth(): AuthFn<Request> {
  return async (request) => {
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

export default eveChannel({ auth: [crmStaffAuth(), localDev()] });
