-- La llamada gratis: de dónde escribe la persona (para ofrecerle horas en su
-- hora aunque no esté en el CRM). Solo añade.

-- AlterTable
ALTER TABLE "whatsapp_dossiers" ADD COLUMN     "country_iso" TEXT,
ADD COLUMN     "timezone" TEXT;

