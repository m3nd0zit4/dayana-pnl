-- Estado de cada persona con Dayana según su chat y el CRM (nueva,
-- conversando, llamada agendada, no contestó, tuvo la llamada, clienta en
-- proceso, ya fue clienta, por revisar, personal). Solo añade.

-- AlterTable
ALTER TABLE "whatsapp_dossiers" ADD COLUMN     "stage" TEXT;

-- CreateIndex
CREATE INDEX "whatsapp_dossiers_stage_idx" ON "whatsapp_dossiers"("stage");
