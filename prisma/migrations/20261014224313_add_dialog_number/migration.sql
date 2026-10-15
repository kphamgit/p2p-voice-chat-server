-- AlterTable: add dialog_number, backfilling existing rows 1..N in creation
-- order so the column can be NOT NULL.
ALTER TABLE "Dialog" ADD COLUMN "dialog_number" INTEGER;

UPDATE "Dialog" AS d
SET "dialog_number" = numbered.n
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "Dialog"
) AS numbered
WHERE d."id" = numbered."id";

ALTER TABLE "Dialog" ALTER COLUMN "dialog_number" SET NOT NULL;
