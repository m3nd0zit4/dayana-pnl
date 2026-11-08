-- CreateTable
CREATE TABLE "agent_threads" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "opener" JSONB,
    "session" JSONB,
    "events" JSONB NOT NULL,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_ui_states" (
    "staff_user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_ui_states_pkey" PRIMARY KEY ("staff_user_id","key")
);

-- CreateIndex
CREATE INDEX "agent_threads_staff_user_id_updated_at_idx" ON "agent_threads"("staff_user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_ui_states" ADD CONSTRAINT "staff_ui_states_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
