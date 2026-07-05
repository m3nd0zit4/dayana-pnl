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
