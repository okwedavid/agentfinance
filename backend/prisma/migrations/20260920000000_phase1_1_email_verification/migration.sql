-- Phase 1.1 email verification (additive).
--
-- Adds email verification tracking to User. Login remains unchanged; this
-- only enables optional email confirmation. Safe for:
--   1. a fresh deploy built from the (full) baseline migration, and
--   2. an existing database that skipped straight to `prisma db push`.
-- Non-destructive, idempotent, additive-only.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'User_emailVerificationToken_key') THEN
    CREATE UNIQUE INDEX "User_emailVerificationToken_key" ON "User"("emailVerificationToken");
  END IF;
END $$;