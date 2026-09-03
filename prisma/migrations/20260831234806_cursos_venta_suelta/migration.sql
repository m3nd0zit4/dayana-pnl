-- La biblioteca gana una segunda forma de comprarse: el curso suelto.
--
-- Hasta ahora sólo se entraba con la mensualidad y los cursos eran
-- contenedores de contenido, invisibles para el catálogo de checkout. Esto no
-- cambia ese camino: lo que hace es abrir otro al lado.
--
-- `sells_standalone` es lo que publica un curso a la venta, y es explícito en
-- vez de derivarse de «tiene fila de precio»: un precio puede existir en el
-- CRM mientras se prepara un lanzamiento, y eso no debe poner un botón de
-- comprar en la web. Por defecto false, así que ninguna fila existente cambia
-- de comportamiento.
--
-- `lifetime_access` es lo que distingue una compra suelta de un mes pagado.
-- Es un booleano y no un `paid_until` lejano porque «no caduca» y «caduca en
-- el año 3000» no son lo mismo para el resto del sistema: los avisos de
-- renovación y el cron de morosidad leen `paid_until` y todos tendrían que
-- aprender a ignorar una fecha centinela.
--
-- OJO — a partir de aquí `paid_until IS NULL` ya NO significa «nunca pagó».
ALTER TABLE "products" ADD COLUMN "sells_standalone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "enrollments" ADD COLUMN "lifetime_access" BOOLEAN NOT NULL DEFAULT false;

-- Una compra a perpetuidad no se puede anunciar como «Membresía extendida»:
-- ese es el rótulo que la persona ve en sus preferencias de notificación.
ALTER TYPE "NotificationEventType" ADD VALUE 'COURSE_ACCESS_GRANTED';
