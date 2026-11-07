-- AlterTable
ALTER TABLE "mcp_access_tokens" ADD COLUMN     "oauth_client_id" TEXT,
ADD COLUMN     "resource" TEXT,
ALTER COLUMN "token_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "mcp_oauth_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secret_hash" TEXT,
    "redirect_uris" TEXT[],
    "token_endpoint_auth_method" TEXT NOT NULL,
    "client_uri" TEXT,
    "logo_uri" TEXT,
    "source" TEXT NOT NULL,
    "metadata_fetched_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_oauth_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "grant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_oauth_tokens" (
    "id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_codes_code_hash_key" ON "mcp_oauth_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mcp_oauth_codes_expires_at_idx" ON "mcp_oauth_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_tokens_token_hash_key" ON "mcp_oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "mcp_oauth_tokens_grant_id_idx" ON "mcp_oauth_tokens"("grant_id");

-- CreateIndex
CREATE INDEX "mcp_oauth_tokens_expires_at_idx" ON "mcp_oauth_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "mcp_access_tokens_oauth_client_id_idx" ON "mcp_access_tokens"("oauth_client_id");

-- AddForeignKey
ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "mcp_oauth_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "mcp_access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

