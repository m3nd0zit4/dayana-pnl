-- El contacto de un enlace de pago pasa a ser opcional.
--
-- Un enlace se acuerda por teléfono, por WhatsApp, o se manda a alguien que
-- todavía no está en el CRM. Exigir la ficha antes de poder cobrar era una
-- limitación que costaba ventas, y los enlaces son ahora el canal principal.
--
-- Sin contacto, el pago sigue el camino anónimo normal del sitio (contacto
-- temporal + reconciliación con lo que reporte el pagador). Con contacto, el
-- cobro se cuelga de esa ficha desde el primer momento.

ALTER TABLE "payment_links" ALTER COLUMN "contact_id" DROP NOT NULL;

-- La clave foránea pasa de CASCADE a SET NULL.
--
-- Con CASCADE, borrar un contacto se llevaba por delante el enlace entero —y
-- con él el rastro de que ese cobro se acordó. El enlace es un hecho del
-- negocio y sobrevive a la limpieza de una ficha; lo que se pierde es a quién
-- apuntaba, que es justo lo que la columna nula representa.
ALTER TABLE "payment_links" DROP CONSTRAINT "payment_links_contact_id_fkey";

ALTER TABLE "payment_links"
  ADD CONSTRAINT "payment_links_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
