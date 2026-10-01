import { withStaff } from "@/lib/api/handler";
import { getWaReminders, patchWaReminders, postWaReminders } from "../../../_lib/handlers";

export const dynamic = "force-dynamic";
// Cada llamada se corta a los 50 s; la página repite hasta terminar.
export const maxDuration = 300;

type Params = { id: string };

/**
 * Recordatorios por WhatsApp de este evento, a mano: vista previa (GET),
 * enviar (POST) y el interruptor de los automáticos (PATCH, para todos).
 */
export const GET = withStaff<Params>("read", async (ctx) => getWaReminders(ctx, ctx.params.id));

export const POST = withStaff<Params>("write", async (ctx) => postWaReminders(ctx, ctx.params.id));

export const PATCH = withStaff<Params>("write", async (ctx) => patchWaReminders(ctx));
