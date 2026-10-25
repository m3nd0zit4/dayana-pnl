-- Interesadas en un taller: cuándo y cómo la IA le ofreció la llamada desde la lista («Ofrecerle la llamada»). Solo agrega.
ALTER TABLE "workshop_interests" ADD COLUMN IF NOT EXISTS "offered_at" TIMESTAMP(3);
ALTER TABLE "workshop_interests" ADD COLUMN IF NOT EXISTS "offered_via" TEXT;
