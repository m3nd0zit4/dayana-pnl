import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { StaffRole } from "@prisma/client";
import { getStaffByEmail, getStaffById } from "@/lib/crm/staff";
import { verifyStaffPassword, verifyPassword } from "@/lib/auth/password";
import {
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/auth/login-rate-limit";
import {
  createStaffSession,
  revokeStaffSession,
  validateStaffSession,
} from "@/lib/auth/staff-sessions";
import {
  createMemberSession,
  revokeMemberSession,
  validateMemberSession,
} from "@/lib/auth/member-sessions";
import {
  getMemberByEmail,
  getMemberAccountByGoogleSub,
  touchMemberLogin,
  upsertMemberAccountForGoogle,
} from "@/lib/crm/member-accounts";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/crm/audit";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export const isGoogleAuthEnabled = () =>
  Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

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
        if (staff) {
          if (!staff.isActive) {
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
            kind: "staff" as const,
          };
        }

        const member = await getMemberByEmail(email);
        if (!member?.account?.passwordHash) {
          recordLoginFailure(email);
          return null;
        }

        const valid = await verifyPassword(
          password,
          member.account.passwordHash
        );
        if (!valid) {
          recordLoginFailure(email);
          return null;
        }

        return {
          id: member.contact.id,
          email,
          name: member.contact.displayName ?? member.contact.firstName,
          kind: "member" as const,
        };
      },
    }),
    ...(isGoogleAuthEnabled() ? [Google] : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;

      const email =
        typeof profile?.email === "string"
          ? profile.email.trim().toLowerCase()
          : "";
      if (!email) return false;
      if (profile?.email_verified === false) return false;

      try {
        await upsertMemberAccountForGoogle({
          email,
          name: profile?.name ?? user?.name ?? null,
          googleSub: account.providerAccountId,
        });
      } catch {
        // Staff emails may never log in via Google, and any linking failure
        // must deny the sign-in rather than mint a session without a member.
        return false;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
          const memberAccount = await getMemberAccountByGoogleSub(
            account.providerAccountId
          );
          if (!memberAccount) return {};
          const dbSession = await createMemberSession({
            memberAccountId: memberAccount.id,
          });
          await touchMemberLogin(memberAccount.id).catch(() => undefined);
          return {
            kind: "member" as const,
            contactId: memberAccount.contactId,
            sessionId: dbSession.id,
            name: token.name,
            email: token.email,
          };
        }

        if (user.kind === "member") {
          const memberAccount = await prisma.memberAccount.findUnique({
            where: { contactId: user.id! },
          });
          if (!memberAccount) return {};
          const dbSession = await createMemberSession({
            memberAccountId: memberAccount.id,
          });
          await touchMemberLogin(memberAccount.id).catch(() => undefined);
          token.kind = "member";
          token.contactId = user.id;
          token.sessionId = dbSession.id;
          return token;
        }

        const dbSession = await createStaffSession({
          staffUserId: user.id!,
        });
        token.kind = "staff";
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

      if (token.kind === "member") {
        const sessionId = token.sessionId as string | undefined;
        const contactId = token.contactId as string | undefined;
        if (!sessionId || !contactId) return {};
        const row = await validateMemberSession(sessionId);
        if (!row) return {};
        return token;
      }

      // Staff path — also the default for legacy tokens without `kind`.
      const sessionId = token.sessionId as string | undefined;
      const staffId = token.staffId as string | undefined;

      if (staffId && !sessionId) {
        const staff = await getStaffById(staffId);
        if (!staff || !staff.isActive) return {};
        const dbSession = await createStaffSession({
          staffUserId: staffId,
        });
        token.kind = "staff";
        token.sessionId = dbSession.id;
        token.role = staff.role;
        return token;
      }

      if (!sessionId || !staffId) return {};

      const row = await validateStaffSession(sessionId);
      if (!row) return {};

      const staff = await getStaffById(staffId);
      if (!staff || !staff.isActive) return {};

      token.kind = "staff";
      token.role = staff.role;
      return token;
    },
    async session({ session, token }) {
      if (token.kind === "member") {
        const contactId = token.contactId as string | undefined;
        const sessionId = token.sessionId as string | undefined;
        if (!contactId || !sessionId) {
          return { ...session, user: undefined };
        }

        const row = await validateMemberSession(sessionId);
        if (!row) {
          return { ...session, user: undefined };
        }

        if (session.user) {
          session.user.id = contactId;
          session.user.kind = "member";
          session.user.sessionId = sessionId;
        }
        return session;
      }

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
        session.user.kind = "staff";
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
      if (!sessionId) return;

      if (token?.kind === "member") {
        await revokeMemberSession(sessionId).catch(() => undefined);
        return;
      }

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
    },
  },
});
