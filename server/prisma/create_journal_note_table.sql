-- Run this in Supabase Dashboard: SQL Editor → New query → paste → Run
-- Creates the JournalNote table so the app works without running Prisma from your machine.

CREATE TABLE IF NOT EXISTS "JournalNote" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title"     TEXT NOT NULL DEFAULT '',
  "content"   TEXT NOT NULL DEFAULT '',
  "fontStyle" TEXT NOT NULL DEFAULT 'balanced',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Optional: create the Prisma migration tracking table if you'll use migrations later
-- (Skip this if you only need the table for the app.)
-- CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
--   "id" VARCHAR(36) NOT NULL PRIMARY KEY,
--   "checksum" VARCHAR(64) NOT NULL,
--   "finished_at" TIMESTAMPTZ,
--   "migration_name" VARCHAR(255) NOT NULL,
--   "logs" TEXT,
--   "rolled_back_at" TIMESTAMPTZ,
--   "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   "applied_steps_count" INTEGER NOT NULL DEFAULT 0
-- );
