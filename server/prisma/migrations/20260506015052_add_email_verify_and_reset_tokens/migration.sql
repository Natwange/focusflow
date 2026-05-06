-- CreateEnum
CREATE TYPE "OpaqueTokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OpaqueAuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OpaqueTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpaqueAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpaqueAuthToken_tokenHash_key" ON "OpaqueAuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OpaqueAuthToken_userId_purpose_idx" ON "OpaqueAuthToken"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "OpaqueAuthToken" ADD CONSTRAINT "OpaqueAuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
