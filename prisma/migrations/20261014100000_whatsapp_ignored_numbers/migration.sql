-- Números personales de Dayana (familia, amigos) que la IA no atiende y que
-- no se importan. Solo la huella HMAC del número, ni el número ni el nombre.
-- Solo añade.

-- CreateTable
CREATE TABLE "whatsapp_ignored_numbers" (
    "phone_hash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_ignored_numbers_pkey" PRIMARY KEY ("phone_hash")
);
