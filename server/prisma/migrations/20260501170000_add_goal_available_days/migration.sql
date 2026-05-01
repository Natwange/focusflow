-- AlterTable (idempotent if column was added manually or migration partially applied)
ALTER TABLE "Goal"
ADD COLUMN IF NOT EXISTS "availableDays" TEXT[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::TEXT[];