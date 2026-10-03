import { withStaff } from "@/lib/api/handler";
import {
  getWaRemindersResponse,
  patchWaRemindersResponse,
  postWaRemindersResponse,
} from "../../../_lib/lifecycle";

export const dynamic = "force-dynamic";
// Cada llamada se corta a los 50 s; la página repite hasta terminar.
export const maxDuration = 300;

type Params = { slug: string };

/**
 * Recordatorios por WhatsApp de esta edición, a mano: vista previa (GET),
 * enviar (POST) y el interruptor de los automáticos (PATCH, para todos los
 * talleres).
 */
export const GET = withStaff<Params>("read", async ({ req, params }) => getWaRemindersResponse(req, params.slug));

export const POST = withStaff<Params>("write", async (ctx) => postWaRemindersResponse(ctx, ctx.params.slug));

export const PATCH = withStaff<Params>("write", async (ctx) => patchWaRemindersResponse(ctx));
