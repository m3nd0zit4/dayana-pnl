import { execSync } from "node:child_process";

execSync("npx prisma generate", {
  stdio: "inherit",
  env: { ...process.env },
});
