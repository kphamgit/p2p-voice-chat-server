-- CreateTable
CREATE TABLE "Unit" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "unit_number" INTEGER NOT NULL,
    "level_id" INTEGER NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
