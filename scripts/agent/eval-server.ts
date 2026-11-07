/**
 * Starts a local `eve dev` for the panel agents' evals, against neondb_dev only.
 *
 *   bun --env-file=../dayana-pnl/.env scripts/agent/eval-server.ts
 *
 * Refuses any other database. Turns on the eval bearer login
 * (`agent/channels/eve.ts` → evalStaffAuth) for the dev OWNER and writes the
 * one-time token to `.eve/eval-token` so `bun run eval:agent` can use it.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const db = new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname;
if (db !== "/neondb_dev") {
  console.error(`eval-server: DATABASE_URL apunta a ${db}, no a /neondb_dev. No arranco.`);
  process.exit(1);
}

const port = process.env.EVE_EVAL_PORT ?? "2100";
const token = randomBytes(32).toString("base64url");
mkdirSync(".eve", { recursive: true });
writeFileSync(".eve/eval-token", JSON.stringify({ token, url: `http://127.0.0.1:${port}` }));

const child = spawn(process.execPath.includes("bun") ? "node" : process.execPath, ["node_modules/eve/bin/eve.js", "dev", "--no-ui", "--port", port, "--host", "127.0.0.1"], {
  stdio: "inherit",
  env: {
    // The shared .env has broken EVE_* values (a stray backtick, e.g. "`/eve/v1"): drop those.
    ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => !(key.startsWith("EVE_") && value?.includes("`")))),
    NODE_ENV: "development",
    CRM_AGENT_EVAL_TOKEN: token,
    CRM_AGENT_EVAL_STAFF_EMAIL: process.env.CRM_AGENT_EVAL_STAFF_EMAIL ?? "owner.dev@example.com",
    // The shared .env may pin a diagnostic model; evals always run the real one.
    GEMINI_MODEL: process.env.EVAL_GEMINI_MODEL ?? "gemini-3.5-flash",
    // Sends stay simulated even if an eval approves one by mistake.
    NOTIFICATIONS_DRY_RUN: "true",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
