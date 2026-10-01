import { withStaff } from "@/lib/api/handler";
import { getWaReminders, patchWaReminders, postWaReminders } from "@/app/api/admin/eventos/_lib/handlers";

export const dynamic = "force-dynamic";
// Cada llamada se corta a los 50 s; la página repite hasta terminar.
export const maxDuration = 300;

/**
 * Ruta de antes: recordatorios por WhatsApp del evento actual. Ver
 * `/api/admin/eventos/[id]/registrations/whatsapp`.
 */
export const GET = withStaff("read", async (ctx) => getWaReminders(ctx));

export const POST = withStaff("write", async (ctx) => postWaReminders(ctx));

export const PATCH = withStaff("write", async (ctx) => patchWaReminders(ctx));
