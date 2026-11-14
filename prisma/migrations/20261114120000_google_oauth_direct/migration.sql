-- Google OAuth directo (sin Vercel Connect). Aditiva: no borra nada.
ALTER TABLE "google_accounts" ADD COLUMN "refresh_token_enc" TEXT;
ALTER TABLE "google_accounts" ADD COLUMN "granted_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "google_accounts" ADD COLUMN "authorized_at" TIMESTAMP(3);

-- Las cuentas conectadas por Vercel Connect no tienen refresh token propio y
-- ya no pueden pedir tokens: se marcan para reconectar una vez, con el motivo
-- visible en Ajustes -> Integraciones -> Google. Solo cambia is_active y
-- last_error; la fila (correo, servicios, connect_subject) queda igual.
UPDATE "google_accounts"
SET "is_active" = false,
    "last_error" = 'Esta cuenta se conectó con el sistema anterior (Vercel Connect), que ya no se usa. Vuelve a conectarla una sola vez en Ajustes → Integraciones → Google con «Volver a conectar con Google».'
WHERE "refresh_token_enc" IS NULL AND "is_active" = true;
