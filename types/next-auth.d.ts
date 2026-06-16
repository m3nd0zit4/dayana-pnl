import type { StaffRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: StaffRole;
      sessionId?: string;
    };
  }

  interface User {
    role: StaffRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    staffId?: string;
    role?: StaffRole;
    sessionId?: string;
  }
}
