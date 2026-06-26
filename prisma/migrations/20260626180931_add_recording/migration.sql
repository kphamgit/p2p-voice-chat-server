-- CreateTable
CREATE TABLE "recording" (
    "id" BIGSERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "local_peer_id" TEXT NOT NULL,
    "remote_peer_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_pkey" PRIMARY KEY ("id")
);
