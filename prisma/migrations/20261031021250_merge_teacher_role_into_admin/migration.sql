-- Merge the `teacher` role into `admin`: move existing teachers over first,
-- then drop `teacher` from the Role enum.
UPDATE "User" SET "role" = 'admin' WHERE "role" = 'teacher';

-- Postgres can't remove a value from an enum, so recreate the type without it.
CREATE TYPE "Role_new" AS ENUM ('student', 'admin');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'student';
