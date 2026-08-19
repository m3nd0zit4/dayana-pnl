-- Nuevo tipo de evento: se cobró un pago pero no hay teléfono de contacto.
--
-- El catálogo (`lib/notifications/platform/catalog.ts`) es un Record exhaustivo
-- sobre este enum, así que TypeScript falla hasta que la entrada existe: esta
-- migración va primero, la entrada del catálogo después.
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_CONTACT_INCOMPLETE';
