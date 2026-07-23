import { auth } from "@/auth";
import type { StaffUser } from "@prisma/client";
import { getStaffById } from "@/lib/crm/staff";
import { readRequestMeta } from "@/lib/auth/request-meta";
import { touchStaffSession, validateStaffSession } from "@/lib/auth/staff-sessions";

export const getStaffSession = async (): Promise<StaffUser | null> => {
  const session = await auth();
  const staffId = session?.user?.id;
  const sessionId = session?.user?.sessionId;
  if (!staffId || !sessionId) return null;

  const staff = await getStaffById(staffId);
  if (!staff || !staff.isActive) return null;

  // Session validity + lastSeen heartbeat run in background (jwt callback already validated).
  void (async () => {
    const row = await validateStaffSession(sessionId);
    if (!row) return;
    const fiveMinMs = 5 * 60 * 1000;
    if (Date.now() - row.lastSeenAt.getTime() >= fiveMinMs) {
      const meta = await readRequestMeta();
      await touchStaffSession(sessionId, meta).catch(() => undefined);
    }
  })();

  return staff;
};

export const requireStaffSession = async (): Promise<StaffUser> => {
  const staff = await getStaffSession();
  if (!staff) {
    throw new Error("STAFF_UNAUTHORIZED");
  }
  return staff;
};

export const getCurrentSessionId = async (): Promise<string | null> => {
  const session = await auth();
  return session?.user?.sessionId ?? null;
};
