-- Busqueda de contactos indexable, e indices de cascada que faltaban.
--
-- La busqueda hacia, por cada token, un OR de seis `ILIKE '%x%'` sobre
-- columnas sueltas. El comodin a la izquierda impide usar cualquier indice
-- btree, asi que cada pulsacion de tecla en el buscador del CRM era un
-- sequential scan de `contacts` reevaluando seis ILIKE por fila, uno de ellos
-- sobre `notes` (@db.Text, potencialmente TOASTeado).
--
-- La solucion es una columna generada con todo lo buscable ya plegado
-- (minusculas, sin tildes) y UN indice GIN de trigramas encima: seis
-- predicados inindexables se convierten en uno indexable, y el AND de tokens
-- pasa a ser una interseccion GIN, que es justo en lo que GIN es bueno.
--
-- Se descartaron dos alternativas:
--   * Seis indices GIN, uno por columna. Obliga al planificador a un BitmapOr
--     de seis exploraciones POR TOKEN, y uno de ellos estaria sobre `notes`,
--     cuyo coste de mantenimiento crece con la longitud del texto.
--   * tsvector / FTS. Empareja lexemas completos: "ana" no encontraria
--     "Mariana" y un telefono se tokeniza entero. Para un CRM en espanol con
--     nombres medio recordados, el trigrama es la semantica correcta.
--
-- `notes` y `source_detail` quedan FUERA de la columna: notes es la mas grande
-- y la que mas se reescribe, y source_detail es un campo interno. Buscar en
-- notas sigue existiendo como camino lento y explicito (opt-in en la UI).
--
-- translate() y no unaccent(): una columna generada STORED exige una expresion
-- IMMUTABLE, y unaccent() es STABLE porque depende de un diccionario mutable.
-- Postgres la rechaza. El mapa explicito es genuinamente inmutable.
--
-- OJO: la expresion de abajo tiene una gemela en JS, `foldForSearch()` en
-- lib/crm/search-normalize.ts. Si cambias una y no la otra, la busqueda
-- devuelve cero resultados en silencio.
--
-- POR QUE UN TRIGGER Y NO `GENERATED ALWAYS ... STORED`:
-- una columna generada seria mas fuerte (la impone la base de datos), pero
-- Prisma no tiene forma de declararla en el DSL. Su differ ve la expresion de
-- generacion como un DEFAULT que sobra y emite
--   ALTER TABLE "contacts" ALTER COLUMN "search_text" DROP DEFAULT;
-- en CADA `prisma migrate dev` a partir de ahora — deriva permanente que
-- alguien tendria que acordarse de borrar a mano cada vez, y que si se cuela
-- destruye la columna. Mantenida por trigger, Prisma ve una columna `text`
-- normal y opcional: cero deriva, para siempre. Es el mismo criterio por el
-- que aqui no se usan indices parciales.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- La expresion vive en UN solo sitio: la usan el trigger y el backfill.
CREATE OR REPLACE FUNCTION contact_search_text(
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone_e164 text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(
    lower(
      coalesce(first_name,   '') || ' ' ||
      coalesce(last_name,    '') || ' ' ||
      coalesce(display_name, '') || ' ' ||
      coalesce(email,        '') || ' ' ||
      coalesce(phone_e164,   '') || ' ' ||
      regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g')
    ),
    'áàäâãéèëêíìïîóòöôõúùüûñç',
    'aaaaaeeeeiiiiooooouuuunc'
  )
$$;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "search_text" text;

CREATE OR REPLACE FUNCTION contacts_search_text_refresh() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_text := contact_search_text(
    NEW.first_name, NEW.last_name, NEW.display_name, NEW.email, NEW.phone_e164
  );
  RETURN NEW;
END;
$$;

-- BEFORE, para escribir la columna en la misma fila sin un UPDATE extra.
-- `UPDATE OF` acota el disparo a las columnas que realmente la componen: sin
-- eso, tocar `notes` o `updated_at` recalcularia trigramas para nada.
CREATE TRIGGER contacts_search_text_biu
  BEFORE INSERT OR UPDATE OF first_name, last_name, display_name, email, phone_e164
  ON "contacts"
  FOR EACH ROW
  EXECUTE FUNCTION contacts_search_text_refresh();

-- Backfill de las filas que ya existen.
UPDATE "contacts"
SET "search_text" = contact_search_text(
  "first_name", "last_name", "display_name", "email", "phone_e164"
);

-- El compuesto (created_at DESC, id DESC) sustituye al suelto: sostiene el
-- keyset de la lista de contactos, que ordena por esa pareja exacta.
-- DropIndex
DROP INDEX "contacts_created_at_idx";

-- CreateIndex
CREATE INDEX "contacts_created_at_id_idx" ON "contacts"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "contacts_search_text_idx" ON "contacts" USING GIN ("search_text" gin_trgm_ops);

-- therapies-list.ts filtra por status y ordena por updatedAt; el indice suelto
-- de updated_at no puede filtrar primero.
-- CreateIndex
CREATE INDEX "enrollments_status_updated_at_idx" ON "enrollments"("status", "updated_at" DESC);

-- Cascadas: 14 relaciones apuntan a Contact con onDelete: Cascade, y esta no
-- tenia ningun indice que empezara por contact_id, asi que borrar un contacto
-- escaneaba la tabla de comentarios entera dentro de la misma transaccion.
-- CreateIndex
CREATE INDEX "lesson_comments_contact_id_idx" ON "lesson_comments"("contact_id");

-- NOTA: `quiz_attempts` tiene el mismo problema (su unico indice es
-- [class_id, contact_id], columna lider equivocada) pero la tabla todavia no
-- existe en produccion: su migracion es parte del trabajo de cuestionarios,
-- que aun no ha aterrizado. Crear el indice aqui reventaria el deploy. Va con
-- esa migracion, no con esta.

-- El registro de envios filtra por canal, sobre la tabla de mayor cardinalidad
-- del esquema (una campana de 100k por 2 canales escribe 200k filas).
-- CreateIndex
CREATE INDEX "notification_deliveries_channel_created_at_idx" ON "notification_deliveries"("channel", "created_at");

-- El panel de registradas hace WHERE webinar_id = ? ORDER BY created_at DESC y
-- hasta ahora no tenia indice.
-- CreateIndex
CREATE INDEX "webinar_registrations_webinar_id_created_at_idx" ON "webinar_registrations"("webinar_id", "created_at" DESC);

-- Nota para el futuro: con la tabla ya poblada (~50k+), un CREATE INDEX normal
-- toma un bloqueo de escritura durante toda la construccion. A partir de ahi,
-- cualquier indice nuevo sobre `contacts` se crea a mano y CONCURRENTLY, fuera
-- de una migracion — Prisma envuelve cada migration.sql en una transaccion y
-- CONCURRENTLY no puede correr dentro de una.
