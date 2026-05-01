-- Align with Prisma schema (TIMESTAMP(3) DateTime + FK ON UPDATE CASCADE).
-- Some databases had TIMESTAMPTZ or NO ACTION from older drift / defaults.

ALTER TABLE "JournalNote" DROP CONSTRAINT IF EXISTS "JournalNote_userId_fkey";

ALTER TABLE "Task" ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMP(3);
ALTER TABLE "User" ALTER COLUMN "lastActiveAt" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "JournalNote"
  ADD CONSTRAINT "JournalNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
