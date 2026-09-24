-- Comunidades y grupos de WhatsApp llevados desde el CRM (miembros, invitaciones).
-- Solo agrega tablas nuevas.

-- CreateTable
CREATE TABLE "whatsapp_communities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'group',
    "parent_id" TEXT,
    "invite_link" TEXT,
    "description" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_communities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_community_members" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "joined_via" TEXT,
    "invited_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),
    "invite_send_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_community_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_communities_archived_at_idx" ON "whatsapp_communities"("archived_at");

-- CreateIndex
CREATE INDEX "whatsapp_community_members_community_id_status_idx" ON "whatsapp_community_members"("community_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_community_members_contact_id_idx" ON "whatsapp_community_members"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_community_members_community_id_contact_id_key" ON "whatsapp_community_members"("community_id", "contact_id");

-- AddForeignKey
ALTER TABLE "whatsapp_communities" ADD CONSTRAINT "whatsapp_communities_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "whatsapp_communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_community_members" ADD CONSTRAINT "whatsapp_community_members_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "whatsapp_communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_community_members" ADD CONSTRAINT "whatsapp_community_members_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
