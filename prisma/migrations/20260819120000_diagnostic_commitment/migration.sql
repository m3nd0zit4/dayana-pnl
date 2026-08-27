-- El cuestionario gana un tramo de intención (qué te frenó, por qué Dayana,
-- puedes invertir hoy). Su puntuación se guarda en columna y no se recalcula
-- desde `answers` porque es la clave de orden de la bandeja del panel: "¿a
-- quién llamo primero?" tiene que resolverse en SQL, no en memoria.
--
-- Aditiva y nullable: las filas anteriores al tramo 2 se quedan en NULL, que
-- es exactamente lo que son — diagnósticos sin esa medida.
ALTER TABLE "diagnostics" ADD COLUMN "commitment_score" INTEGER;
