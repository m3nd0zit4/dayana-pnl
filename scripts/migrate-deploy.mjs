import { execSync } from "node:child_process";
import { ensurePrismaDatabaseEnv } from "./ensure-prisma-env.mjs";

ensurePrismaDatabaseEnv();
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env },
});
