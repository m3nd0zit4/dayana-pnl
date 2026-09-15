import { NextResponse } from "next/server";
import { withStaff } from "@/lib/api/handler";
import { listCommentsForClass } from "@/lib/lms/class-comments";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = withStaff<Params>("read", async ({ params }) => {
  const { id } = params;
  const comments = await listCommentsForClass(id);
  return NextResponse.json({ comments });
});
