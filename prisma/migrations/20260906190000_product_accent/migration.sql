-- La tarjeta pública puede llevar color o degradado en el título.
--
-- Hasta ahora la única personalización de una tarjeta era la foto: para dar
-- color a un título había que tocar código, así que en la práctica no se hacía.
--
-- Es un enum y no un texto libre con un color: la web tiene siete colores, y
-- dejar escribir cualquiera permite publicar un título ilegible sobre el papel
-- crema sin que nada lo impida hasta que ya está en producción. Cerrando la
-- lista aquí, la base y el panel no pueden divergir — las clases que pinta cada
-- valor viven en `lib/products/accents.ts`, contra estos mismos nombres.
CREATE TYPE "ProductAccent" AS ENUM (
  'NEUTRAL',
  'TERRACOTTA',
  'TERRACOTTA_GRADIENT',
  'SAND_GRADIENT',
  'INK_GRADIENT'
);

-- `NOT NULL DEFAULT 'NEUTRAL'`: los productos que ya existen se pintan igual
-- que antes. El acento es decoración y su ausencia no es un estado distinto,
-- así que una columna nullable sólo añadiría un caso que tratar en cada lectura.
ALTER TABLE "products"
  ADD COLUMN "accent" "ProductAccent" NOT NULL DEFAULT 'NEUTRAL';
