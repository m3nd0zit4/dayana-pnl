-- Material descargable opcional del webinar gratuito.
--
-- Cuatro columnas en la propia fila en vez de una tabla hija: es un unico
-- adjunto, asi que un `sortOrder` y una relacion uno-a-muchos no aportarian
-- nada. Mismo patron que el material de las clases del curso.
--
-- Aditiva y opcional: sin material la landing simplemente no muestra la
-- seccion, y la publicacion no se bloquea.

-- AlterTable
ALTER TABLE "free_webinars"
  ADD COLUMN "material_url" TEXT,
  ADD COLUMN "material_file_name" TEXT,
  ADD COLUMN "material_mime_type" TEXT,
  ADD COLUMN "material_size_bytes" INTEGER;
