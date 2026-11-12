-- CreateTable
CREATE TABLE "TextItem" (
    "id" SERIAL NOT NULL,
    "item_number" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "media" TEXT,
    "item_group_id" INTEGER NOT NULL,

    CONSTRAINT "TextItem_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TextItem" ADD CONSTRAINT "TextItem_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "ItemGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

