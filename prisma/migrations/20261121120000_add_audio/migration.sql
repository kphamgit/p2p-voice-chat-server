-- DropForeignKey
ALTER TABLE "ShadowingSentence" DROP CONSTRAINT "ShadowingSentence_created_by_id_fkey";

-- AlterTable
ALTER TABLE "QuestionItem" DROP COLUMN "audio",
DROP COLUMN "audio_text",
DROP COLUMN "trailing_audio",
DROP COLUMN "trailing_audio_text",
DROP COLUMN "trailing_voice_name",
DROP COLUMN "voice_name",
ADD COLUMN     "audio_id" INTEGER,
ADD COLUMN     "trailing_audio_id" INTEGER;

-- DropTable
DROP TABLE "ShadowingSentence";

-- CreateTable
CREATE TABLE "Audio" (
    "id" SERIAL NOT NULL,
    "s3_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tts_text" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "speed" DOUBLE PRECISION,
    "in_library" BOOLEAN NOT NULL DEFAULT false,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Audio_s3_key_key" ON "Audio"("s3_key");

-- CreateIndex
CREATE INDEX "Audio_in_library_created_at_idx" ON "Audio"("in_library", "created_at");

-- CreateIndex
CREATE INDEX "QuestionItem_audio_id_idx" ON "QuestionItem"("audio_id");

-- CreateIndex
CREATE INDEX "QuestionItem_trailing_audio_id_idx" ON "QuestionItem"("trailing_audio_id");

-- AddForeignKey
ALTER TABLE "QuestionItem" ADD CONSTRAINT "QuestionItem_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "Audio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionItem" ADD CONSTRAINT "QuestionItem_trailing_audio_id_fkey" FOREIGN KEY ("trailing_audio_id") REFERENCES "Audio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audio" ADD CONSTRAINT "Audio_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

