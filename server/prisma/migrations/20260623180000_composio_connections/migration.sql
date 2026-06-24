-- CreateTable
CREATE TABLE "ComposioConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolkit" TEXT NOT NULL,
    "composioAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComposioConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComposioConnection_userId_idx" ON "ComposioConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ComposioConnection_userId_toolkit_key" ON "ComposioConnection"("userId", "toolkit");

-- AddForeignKey
ALTER TABLE "ComposioConnection" ADD CONSTRAINT "ComposioConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
