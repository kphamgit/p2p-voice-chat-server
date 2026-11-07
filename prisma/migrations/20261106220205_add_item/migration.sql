-- CreateTable
CREATE TABLE "Item" (
    "id" SERIAL NOT NULL,
    "item_number" INTEGER NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_group_id" INTEGER NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_item_group_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "ItemGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
