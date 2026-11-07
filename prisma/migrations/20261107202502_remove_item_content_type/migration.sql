-- Remove Item.content_type (and its now-unused ContentType enum). Existing
-- values are discarded; ItemGroup.item_type describes the kind of items instead.
ALTER TABLE "Item" DROP COLUMN "content_type";
DROP TYPE "ContentType";
