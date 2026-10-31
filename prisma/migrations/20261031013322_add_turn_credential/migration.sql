-- CreateTable
CREATE TABLE "TurnCredential" (
    "username" TEXT NOT NULL,
    "iceServers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurnCredential_pkey" PRIMARY KEY ("username")
);
