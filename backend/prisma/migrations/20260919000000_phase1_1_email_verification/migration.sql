-- Phase 1.1 migration: email verification architecture.
--
-- Additive / non-destructive. Prepares the User table so an email provider can
-- be connected later WITHOUT rewriting authentication:
--   emailVerified            - safe default false (login is NOT gated yet)
--   emailVerificationToken   - one-time token bound to the address
--   emailVerificationExpiresAt - expiry for the token
--
-- Safe on existing databases via the ADD COLUMN IF NOT EXISTS pattern.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3);

-- The token must be unique when present; partial unique index keeps NULLs free.
CREATE UNIQUE INDEX IF NOT EXISTS "User_emailVerificationToken_key" ON "User"("emailVerificationToken") WHERE "emailVerificationToken" IS NOT NULL;