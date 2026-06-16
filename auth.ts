import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { StaffRole } from "@prisma/client";
import { getStaffByEmail, getStaffById } from "@/lib/crm/staff";
import { verifyStaffPassword } from "@/lib/auth/password";
import {
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/auth/login-rate-limit";
import {
  createStaffSession,
  revokeStaffSession,
  validateStaffSession,
} from "@/lib/auth/staff-sessions";
import { writeAuditLog } from "@/lib/crm/audit";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development"
      ? "dev-only-auth-secret-replace-in-env"
      : undefined),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: {
    signIn: "/admin/sign-in",
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        if (isLoginRateLimited(email)) return null;

        const staff = await getStaffByEmail(email);
        if (!staff || !staff.isActive) {
          recordLoginFailure(email);
          return null;
        }

        const valid = await verifyStaffPassword(password, staff.passwordHash);
        if (!valid) {
          recordLoginFailure(email);
          await writeAuditLog({
            staffUserId: staff.id,
            action: "LOGIN_FAILED",
            entityType: "StaffUser",
            entityId: staff.id,
          }).catch(() => undefined);
          return null;
        }

        return {
          id: staff.id,
          email: staff.email,
          name: staff.displayName,
          role: staff.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const dbSession = await createStaffSession({
          staffUserId: user.id!,
        });
        token.staffId = user.id;
        token.role = (user as { role?: StaffRole }).role;
        token.sessionId = dbSession.id;
        await writeAuditLog({
          staffUserId: user.id,
          action: "LOGIN_SUCCESS",
          entityType: "StaffUser",
          entityId: user.id!,
          changes: { sessionId: dbSession.id },
        }).catch(() => undefined);
        return token;
      }

      const sessionId = token.sessionId as string | undefined;
      const staffId = token.staffId as string | undefined;

      if (staffId && !sessionId) {
        const staff = await getStaffById(staffId);
        if (!staff || !staff.isActive) return {};
        const dbSession = await createStaffSession({
          staffUserId: staffId,
        });
        token.sessionId = dbSession.id;
        token.role = staff.role;
        return token;
      }

      if (!sessionId || !staffId) return {};

      const row = await validateStaffSession(sessionId);
      if (!row) return {};

      const staff = await getStaffById(staffId);
      if (!staff || !staff.isActive) return {};

      token.role = staff.role;
      return token;
    },
    async session({ session, token }) {
      const staffId = token.staffId as string | undefined;
      const sessionId = token.sessionId as string | undefined;
      if (!staffId || !sessionId) {
        return { ...session, user: undefined };
      }

      const row = await validateStaffSession(sessionId);
      if (!row) {
        return { ...session, user: undefined };
      }

      const staff = await getStaffById(staffId);
      if (!staff || !staff.isActive) {
        return { ...session, user: undefined };
      }

      if (session.user) {
        session.user.id = staffId;
        session.user.role = staff.role;
        session.user.sessionId = sessionId;
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sessionId = token?.sessionId as string | undefined;
      if (sessionId) {
        await revokeStaffSession(sessionId).catch(() => undefined);
        const staffId = token?.staffId as string | undefined;
        if (staffId) {
          await writeAuditLog({
            staffUserId: staffId,
            action: "SESSION_REVOKED",
            entityType: "StaffSession",
            entityId: sessionId,
            changes: { reason: "sign_out" },
          }).catch(() => undefined);
        }
      }
    },
  },
});
