import { withStaff } from "@/lib/api/handler";
import { deleteVideo, getVideo, postVideo } from "@/app/api/admin/eventos/_lib/handlers";

export const dynamic = "force-dynamic";

/** Ruta de antes: el vídeo del evento actual. Ver `/api/admin/eventos/[id]/video`. */
export const POST = withStaff("write", async (ctx) => postVideo(ctx));

export const GET = withStaff("read", async () => getVideo());

export const DELETE = withStaff("write", async (ctx) => deleteVideo(ctx));
