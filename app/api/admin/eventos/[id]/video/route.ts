import { withStaff } from "@/lib/api/handler";
import { deleteVideo, getVideo, postVideo } from "../../_lib/handlers";

export const dynamic = "force-dynamic";

type Params = { id: string };

/** Vídeo promocional (Mux): subir, reconciliar el estado y quitarlo. */
export const POST = withStaff<Params>("write", async (ctx) => postVideo(ctx, ctx.params.id));

export const GET = withStaff<Params>("read", async ({ params }) => getVideo(params.id));

export const DELETE = withStaff<Params>("write", async (ctx) => deleteVideo(ctx, ctx.params.id));
