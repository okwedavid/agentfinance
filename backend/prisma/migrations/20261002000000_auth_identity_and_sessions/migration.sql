-- Auth: multi-provider identity linking + durable OAuth state.
--
-- ADDITIVE ONLY. No table is dropped, truncated, or rewritten. No user row is
-- deleted and no existing account is merged or renamed.
--
-- 1) AuthIdentity
--    The previous `User.oauthId` single column could hold only ONE provider per
--    user. Linking a second provider overwrote the first, so the original login
--    silently stopped resolving. This table holds many provider identities per
--    user, while @@unique([provider, providerUserId]) still guarantees that one
--    provider account maps to exactly one AgentFinance user.
--
-- 2) Existing oauthId values are migrated into AuthIdentity so historical
--    Google logins keep working unchanged. User.oauthId is left in place (still
--    written) purely so an older deployed build can read it during a rolling
--    deploy; the column is nullable and nothing new depends on it.
--
-- 3) AuthSession.expiresAt
--    Session lifetime is currently enforced only by the JWT's own expiry. An
--    explicit expiry lets the server refuse a session whose JWT has not yet
--    reached its own exp, and lets old sessions be reaped.

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- A provider account belongs to exactly one AgentFinance user.
CREATE UNIQUE INDEX "AuthIdentity_provider_providerUserId_key" ON "AuthIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- Backfill: split the legacy single-column value "google:12345" into its
-- provider and subject parts. Rows that are already linked are skipped by the
-- unique index if this is ever re-run against partially migrated data.
INSERT INTO "AuthIdentity" ("id", "userId", "provider", "providerUserId", "email", "emailVerified", "createdAt")
SELECT
    'legacy_' || md5(u."id" || ':' || u."oauthId"),
    u."id",
    split_part(u."oauthId", ':', 1),
    substr(u."oauthId", length(split_part(u."oauthId", ':', 1)) + 2),
    u."email",
    -- Legacy links were created from an OAuth handshake. Only Google asserted a
    -- verified email, so nothing is promoted to verified that we cannot prove.
    (split_part(u."oauthId", ':', 1) = 'google'),
    u."createdAt"
FROM "User" AS u
WHERE u."oauthId" IS NOT NULL
  AND u."oauthId" LIKE '%:%'
  AND NOT EXISTS (
    SELECT 1 FROM "AuthIdentity" AS ai
    WHERE ai."provider" = split_part(u."oauthId", ':', 1)
      AND ai."providerUserId" = substr(u."oauthId", length(split_part(u."oauthId", ':', 1)) + 2)
  );

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- Existing sessions have an unknown intended lifetime. Rather than guess one and
-- either lock users out or silently extend sessions, give them the maximum JWT
-- lifetime the server issues. New sessions get an explicit value at creation.
UPDATE "AuthSession"
SET "expiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "expiresAt" IS NULL;

ALTER TABLE "AuthSession" ALTER COLUMN "expiresAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- 4) OAuthState
--    The OAuth `state` handshake was held in an in-process Map. On Render the
--    /start and /callback hops can land on DIFFERENT instances, which loses the
--    state and fails a login that was actually correct. Persisting it makes the
--    handshake single-use across instances.
--
-- NOTE: `state` is intentionally the primary key rather than an autoincrement
-- id. The value is already a 256-bit random token, so an index on it is both
-- sufficient for the lookup and collision-free, and it means a duplicate insert
-- is rejected by the database rather than by application code.

-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- Reap by expiry; the callback deletes the row on use.
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
