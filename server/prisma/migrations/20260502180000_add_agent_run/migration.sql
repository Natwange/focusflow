-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evaluation" JSONB NOT NULL,
    "failureAnalysis" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "rebalancePreview" JSONB NOT NULL,
    "acceptedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_goalId_userId_idx" ON "AgentRun"("goalId", "userId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
