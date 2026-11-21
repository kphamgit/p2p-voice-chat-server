-- CreateTable
CREATE TABLE "ShadowingSentence" (
    "id" SERIAL NOT NULL,
    "sentence" TEXT NOT NULL,
    "tts_text" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "s3_key" TEXT NOT NULL,
    "voice" TEXT NOT NULL DEFAULT '',
    "tts" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowingSentence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShadowingSentence_created_at_idx" ON "ShadowingSentence"("created_at");

-- AddForeignKey
ALTER TABLE "ShadowingSentence" ADD CONSTRAINT "ShadowingSentence_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
