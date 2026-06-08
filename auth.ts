import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { StaffRole } from "@prisma/client";
import { getStaffByEmail } from "@/lib/crm/staff";
import { verifyStaffPassword } from "@/lib/auth/password";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development"
      ? "dev-only-auth-secret-replace-in-env"
      : undefined),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: {
    signIn: "/admin/sign-in",
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

        const staff = await getStaffByEmail(email);
        if (!staff || !staff.isActive) return null;

        const valid = await verifyStaffPassword(password, staff.passwordHash);
        if (!valid) return null;

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
    jwt({ token, user }) {
      if (user) {
        token.staffId = user.id;
        token.role = (user as { role?: StaffRole }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.staffId as string;
        session.user.role = token.role as StaffRole;
      }
      return session;
    },
  },
});
