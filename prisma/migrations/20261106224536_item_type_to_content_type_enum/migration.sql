-- Replace Item.item_type (free text) with Item.content_type (enum).
-- Renamed rather than dropped/re-added so any existing values are kept;
-- the cast fails if a row holds a value outside the enum.
CREATE TYPE "ContentType" AS ENUM ('text_only', 'question_only');
ALTER TABLE "Item" RENAME COLUMN "item_type" TO "content_type";
ALTER TABLE "Item" ALTER COLUMN "content_type" TYPE "ContentType" USING ("content_type"::"ContentType");
