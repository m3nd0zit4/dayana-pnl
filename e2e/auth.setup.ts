import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const STORAGE_STATE = path.join(__dirname, ".auth", "owner.json");

/**
 * Login real de staff, para el Tier B.
 *
 * Solo corre cuando hay `DATABASE_URL` — `playwright.config.ts` ni siquiera
 * registra este proyecto sin ella. No hay atajo posible: `auth.ts` revalida
 * `token.sessionId` contra una fila `StaffSession` en cada request, así que
 * inyectar una cookie a mano no sirve de nada.
 *
 * Antes de correrlo:
 *   bun run db:migrate:deploy && bun run db:seed
 * con `STAFF_OWNER_EMAIL` y `STAFF_OWNER_PASSWORD` en el entorno — las mismas
 * variables que `prisma/seed.ts:296-306` usa para hacer upsert del OWNER.
 */
setup("autenticar como OWNER", async ({ page }) => {
  const email = process.env.STAFF_OWNER_EMAIL?.trim();
  const password = process.env.STAFF_OWNER_PASSWORD;

  expect(
    email && password,
    "Tier B necesita STAFF_OWNER_EMAIL y STAFF_OWNER_PASSWORD (los mismos del seed)",
  ).toBeTruthy();

  await page.goto("/acceso");

  // El formulario no pone `name` ni `id` en los inputs, así que se seleccionan
  // por tipo. Si eso cambia, esto es lo primero que se rompe.
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  await page.getByRole("button", { name: "Entrar" }).click();

  // El backend enruta por rol: staff acaba en /admin.
  await page.waitForURL(/\/admin(\/|$)/, { timeout: 30_000 });
  await expect(page.locator("[data-slot='sidebar-wrapper']")).toBeAttached();

  await page.context().storageState({ path: STORAGE_STATE });
});
