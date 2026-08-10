-- Cupo previsto del webinar gratuito.
--
-- Informativo, no un tope: pasado el número la gente se sigue registrando y
-- sigue recibiendo el enlace. El DEFAULT hace que la fila que ya existe en
-- cada entorno —incluida producción— quede en 100 sin tener que tocarla a
-- mano tras el despliegue.

-- AlterTable
ALTER TABLE "free_webinars"
  ADD COLUMN "capacity" INTEGER DEFAULT 100;
