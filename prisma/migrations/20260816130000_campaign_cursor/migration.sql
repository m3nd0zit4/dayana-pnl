-- Punto de reanudacion de una campana masiva.
--
-- El envio recorria la audiencia por offset sobre un array ya materializado:
-- cada paso de Inngest recargaba el contexto —que leia la tabla de contactos
-- ENTERA— y descartaba todo salvo su rebanada de 25. A 100k contactos eso son
-- 4.000 pasos x 100.000 filas = 400 millones de filas leidas por campana.
--
-- Con cursor keyset cada paso lee solo su lote. Estas dos columnas guardan
-- hasta donde llego, ordenado por (created_at, id) ascendente.
--
-- Inngest memoriza el retorno de cada `step.run`, asi que el cursor se podria
-- encadenar solo por ahi. Se persiste igualmente porque eso sobrevive a un
-- cambio de version de la funcion o a una cancelacion manual, hace respondible
-- "hasta donde llego" desde el panel, y se escribe en el MISMO update que
-- incrementa los contadores — asi posicion y contadores no pueden discrepar.

-- AlterTable
ALTER TABLE "notification_campaigns"
  ADD COLUMN "cursor_at" TIMESTAMP(3),
  ADD COLUMN "cursor_contact_id" TEXT;
