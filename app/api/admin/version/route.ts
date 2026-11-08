import { withStaff } from "@/lib/api/handler";

/**
 * Which build is serving the panel, so a tab opened before a release can tell
 * it is running old code (8-nov: a computer tab from before the sync release
 * never showed the phone's conversations). Never cached.
 */
export const dynamic = "force-dynamic";

export const GET = withStaff("read", async () =>
  Response.json(
    { version: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    { headers: { "Cache-Control": "no-store" } }
  )
);
