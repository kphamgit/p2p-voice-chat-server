-- Make QuestionItem.format required with a default of 1.
-- Existing rows without a format get 1 first, so NOT NULL can be applied.
UPDATE "QuestionItem" SET "format" = 1 WHERE "format" IS NULL;
ALTER TABLE "QuestionItem" ALTER COLUMN "format" SET DEFAULT 1;
ALTER TABLE "QuestionItem" ALTER COLUMN "format" SET NOT NULL;
