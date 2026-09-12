-- La tarjeta pública gana un acento de color para el título y el precio.
--
-- Es un enum y no un texto libre a propósito: la web tiene siete colores, y
-- una columna de texto dejaría publicar cualquier cosa sobre el papel crema
-- sin que nada protestara hasta verlo publicado. El motivo largo está en
-- lib/products/accents.ts.
--
-- `NEUTRAL` por defecto: los dieciséis paquetes que ya existen siguen
-- pintándose exactamente igual que antes de esta migración.

CREATE TYPE "ProductAccent" AS ENUM (
  'NEUTRAL',
  'TERRACOTTA',
  'TERRACOTTA_GRADIENT',
  'SAND_GRADIENT',
  'INK_GRADIENT'
);

ALTER TABLE "products"
  ADD COLUMN "accent" "ProductAccent" NOT NULL DEFAULT 'NEUTRAL';
