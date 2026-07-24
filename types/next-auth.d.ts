import type { StaffRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

export type SessionUserKind = "staff" | "member";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      kind: SessionUserKind;
      role?: StaffRole;
      sessionId?: string;
      avatarUrl?: string | null;
      /** Member only: contact still has a placeholder phone (Google/email
       *  signup that never captured a real number) — onboarding incomplete. */
      needsPhone?: boolean;
    };
  }

  interface User {
    kind?: SessionUserKind;
    role?: StaffRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    kind?: SessionUserKind;
    staffId?: string;
    contactId?: string;
    role?: StaffRole;
    sessionId?: string;
  }
}
