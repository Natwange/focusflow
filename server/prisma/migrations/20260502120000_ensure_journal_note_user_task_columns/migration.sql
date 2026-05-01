-- Ensure objects that exist in schema.prisma but were missing from early migrations
-- (or only applied via db push / manual drift). Idempotent: safe if already present.

-- CreateTable
CREATE TABLE IF NOT EXISTS "JournalNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "fontStyle" TEXT NOT NULL DEFAULT 'balanced',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalNote_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (ignore if already present)
DO $ensure$
BEGIN
  ALTER TABLE "JournalNote"
    ADD CONSTRAINT "JournalNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$ensure$;

-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "streakCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "streakDateKey" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);

-- AlterTable Task
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

-- Match Prisma @updatedAt (no database default)
ALTER TABLE "JournalNote" ALTER COLUMN "updatedAt" DROP DEFAULT;
