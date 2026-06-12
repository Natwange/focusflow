-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "outcomeCheckedAt" TIMESTAMP(3);
ALTER TABLE "AgentRun" ADD COLUMN "completionRateBefore" DOUBLE PRECISION;
ALTER TABLE "AgentRun" ADD COLUMN "completionRateAfter" DOUBLE PRECISION;
ALTER TABLE "AgentRun" ADD COLUMN "missedTasksBefore" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "missedTasksAfter" INTEGER;
ALTER TABLE "AgentRun" ADD COLUMN "effectivenessScore" DOUBLE PRECISION;
ALTER TABLE "AgentRun" ADD COLUMN "outcomeStatus" TEXT;
