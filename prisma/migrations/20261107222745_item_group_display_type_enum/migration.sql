-- CreateEnum
CREATE TYPE "ItemDisplayType" AS ENUM ('scrolling', 'individual_screen');

-- Convert ItemGroup.display_type from text to the enum, keeping existing values.
-- Anything that isn't one of the two allowed values becomes NULL.
ALTER TABLE "ItemGroup"
  ALTER COLUMN "display_type" TYPE "ItemDisplayType"
  USING (CASE WHEN "display_type" IN ('scrolling', 'individual_screen')
              THEN "display_type"::"ItemDisplayType" END);
