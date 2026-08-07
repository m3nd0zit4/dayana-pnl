-- Curso: marca de contenido de biblioteca + claves estables del currículo.
--
-- `is_course_content` distingue el curso contenedor de módulos de un ítem de
-- checkout; el acceso lo abre la membresía (lib/lms/membership.ts).
--
-- `slug` en módulos y clases es la clave estable del currículo versionado. Es
-- nullable a propósito: las filas creadas a mano desde el CRM no la llevan.
-- Las dos UNIQUE conviven con eso porque Postgres trata cada NULL como
-- distinto, así que las filas existentes (todas NULL tras el ADD COLUMN) no
-- colisionan entre sí.

-- AlterTable
ALTER TABLE "products"
  ADD COLUMN "is_course_content" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "course_modules"
  ADD COLUMN "slug" TEXT;

-- AlterTable
ALTER TABLE "live_class_sessions"
  ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "course_modules_product_id_slug_key" ON "course_modules"("product_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "live_class_sessions_product_id_slug_key" ON "live_class_sessions"("product_id", "slug");
