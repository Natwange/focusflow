-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "planRunId" TEXT,
ADD COLUMN     "planSource" TEXT,
ADD COLUMN     "unitEnd" INTEGER,
ADD COLUMN     "unitStart" INTEGER;
