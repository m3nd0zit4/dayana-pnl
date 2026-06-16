import { execSync } from "node:child_process";
import { ensurePrismaDatabaseEnv } from "./ensure-prisma-env.mjs";

if (process.env.DATABASE_URL?.trim()) {
  ensurePrismaDatabaseEnv();
}

execSync("npx prisma generate", {
  stdio: "inherit",
  env: { ...process.env },
});
