-- CreateTable
CREATE TABLE "Card" (
    "id" SERIAL NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "definition" TEXT NOT NULL DEFAULT '',
    "part_of_speech" VARCHAR(50) NOT NULL DEFAULT '',
    "difficulty" SMALLINT NOT NULL DEFAULT 0,
    "sense_id" INTEGER,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardReview" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "card_id" INTEGER NOT NULL,
    "easiness" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "next_review_at" TIMESTAMP(3),

    CONSTRAINT "CardReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "card_id" INTEGER NOT NULL,
    "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" VARCHAR(20) NOT NULL,
    "chosen_definition" TEXT NOT NULL DEFAULT '',
    "latency_ms" INTEGER NOT NULL,
    "quality" SMALLINT NOT NULL,
    "graded" BOOLEAN NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "easiness" DOUBLE PRECISION NOT NULL,
    "time_limit_ms" INTEGER NOT NULL,
    "fast_answer_ms" INTEGER NOT NULL,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Card_sense_id_idx" ON "Card"("sense_id");

-- CreateIndex
CREATE INDEX "CardReview_card_id_idx" ON "CardReview"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "CardReview_user_id_card_id_key" ON "CardReview"("user_id", "card_id");

-- CreateIndex
CREATE INDEX "ReviewLog_user_id_answered_at_idx" ON "ReviewLog"("user_id", "answered_at" DESC);

-- CreateIndex
CREATE INDEX "ReviewLog_card_id_idx" ON "ReviewLog"("card_id");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "Sense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardReview" ADD CONSTRAINT "CardReview_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardReview" ADD CONSTRAINT "CardReview_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

