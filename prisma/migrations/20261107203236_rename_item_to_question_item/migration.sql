-- Rename model Item → QuestionItem. Renamed in place (not dropped/recreated)
-- so existing rows are kept; the primary key, foreign key and id sequence are
-- renamed too so they match the names Prisma expects for the new table.
ALTER TABLE "Item" RENAME TO "QuestionItem";
ALTER TABLE "QuestionItem" RENAME CONSTRAINT "Item_pkey" TO "QuestionItem_pkey";
ALTER TABLE "QuestionItem" RENAME CONSTRAINT "Item_item_group_id_fkey" TO "QuestionItem_item_group_id_fkey";
ALTER SEQUENCE "Item_id_seq" RENAME TO "QuestionItem_id_seq";
