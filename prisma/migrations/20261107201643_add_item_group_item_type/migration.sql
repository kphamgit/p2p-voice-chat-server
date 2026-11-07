-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('text', 'question');

-- AlterTable
ALTER TABLE "ItemGroup" ADD COLUMN     "item_type" "ItemType";
