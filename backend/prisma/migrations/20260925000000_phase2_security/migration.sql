-- Phase 2 security hardening: per-user task lookups get an index, and the
-- retry endpoint bounds retries with a zero-value counter column. Both
-- changes are purely additive and safe on existing rows.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "Task_userId_idx" ON "Task"("userId");