/**
 * A signed-in browser state for the dev OWNER, without a password — for
 * screenshots and Playwright against a local `next dev` on neondb_dev.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/dev/staff-session-cookie.ts [out.json] [baseUrl]
 *
 * Creates a real `StaffSession` row (auth.ts revalidates it on every request,
 * so a hand-made cookie would not work) and writes a Playwright storage state
 * with the NextAuth session cookie. Refuses any database but neondb_dev and
 * any non-local base URL. Revoke with the session id it prints, or let it
 * expire.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encode } from "next-auth/jwt";
import { createStaffSession } from "@/lib/auth/staff-sessions";
import { getStaffByEmail } from "@/lib/crm/staff";

if (new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname !== "/neondb_dev") {
  console.error("staff-session-cookie: solo contra /neondb_dev.");
  process.exit(1);
}
const out = process.argv[2] ?? ".dev/owner-storage.json";
const baseUrl = new URL(process.argv[3] ?? "http://localhost:3100");
if (!["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
  console.error("staff-session-cookie: solo para un servidor local.");
  process.exit(1);
}
const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error("staff-session-cookie: falta AUTH_SECRET.");
  process.exit(1);
}

const staff = await getStaffByEmail(process.env.DEV_STAFF_EMAIL ?? "owner.dev@example.com");
if (!staff || !staff.isActive || staff.role !== "OWNER") {
  console.error("staff-session-cookie: no hay un OWNER activo con ese correo en dev.");
  process.exit(1);
}

const session = await createStaffSession({ staffUserId: staff.id });
const cookieName = "authjs.session-token";
const value = await encode({
  secret,
  salt: cookieName,
  token: { kind: "staff", staffId: staff.id, role: staff.role, sessionId: session.id, email: staff.email, name: staff.displayName, sub: staff.id },
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    cookies: [
      { name: cookieName, value, domain: baseUrl.hostname, path: "/", expires: Math.floor(Date.now() / 1000) + 8 * 3600, httpOnly: true, secure: false, sameSite: "Lax" },
    ],
    origins: [],
  })
);
console.log(`staff-session-cookie: sesión ${session.id} para ${staff.email} → ${out}`);
process.exit(0);
