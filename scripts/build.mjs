import { execSync } from "node:child_process";
import { ensurePrismaDatabaseEnv } from "./ensure-prisma-env.mjs";

ensurePrismaDatabaseEnv();

const env = { ...process.env };

execSync("npx prisma generate", { stdio: "inherit", env });
execSync("npx prisma migrate deploy", { stdio: "inherit", env });
execSync("npx next build", { stdio: "inherit", env });
