-- Phase 3 reward economy: task-generated reward pool accounting.
--
-- All changes are purely additive (CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS). Existing rows and payout flows are untouched; legacy payouts
-- without a SettlementRecord remain fully compatible with the approve path.
--
-- Accounting model (all BNB amounts stored as decimal STRINGS to avoid float
-- corruption):
--   RewardEvent        one immutable, idempotent reward per qualifying task
--   RewardLedger       append-only, immutable audit trail
--   UserRewardBalance  per-user running aggregates (source of truth per user)
--   RewardPool         single-row global aggregate (source of truth for pool)
--   PoolFundingEvent   funding provenance (PENDING -> CONFIRMED)
--   SettlementRecord   per-payout reservation lifecycle (RESERVED->SETTLED/RELEASED)

CREATE TABLE IF NOT EXISTS "RewardEvent" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "rewardType" TEXT NOT NULL DEFAULT 'TASK_COMPLETION',
  "rewardAmountBnb" TEXT NOT NULL,
  "rewardAsset" TEXT NOT NULL DEFAULT 'BNB',
  "calculationVersion" TEXT NOT NULL,
  "taskValueMetric" JSONB,
  "status" TEXT NOT NULL DEFAULT 'CREDITED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RewardEvent_taskId_key" ON "RewardEvent"("taskId");
CREATE INDEX IF NOT EXISTS "RewardEvent_userId_idx" ON "RewardEvent"("userId");
CREATE INDEX IF NOT EXISTS "RewardEvent_createdAt_idx" ON "RewardEvent"("createdAt");

CREATE TABLE IF NOT EXISTS "RewardLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amountBnb" TEXT NOT NULL,
  "runningBalanceBnb" TEXT NOT NULL,
  "referenceId" TEXT,
  "note" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RewardLedger_userId_idx" ON "RewardLedger"("userId");
CREATE INDEX IF NOT EXISTS "RewardLedger_createdAt_idx" ON "RewardLedger"("createdAt");

CREATE TABLE IF NOT EXISTS "UserRewardBalance" (
  "userId" TEXT NOT NULL,
  "totalEarnedBnb" TEXT NOT NULL DEFAULT '0',
  "settledBnb" TEXT NOT NULL DEFAULT '0',
  "reservedBnb" TEXT NOT NULL DEFAULT '0',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRewardBalance_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "RewardPool" (
  "id" SERIAL NOT NULL,
  "generatedBnb" TEXT NOT NULL DEFAULT '0',
  "fundedBnb" TEXT NOT NULL DEFAULT '0',
  "settledBnb" TEXT NOT NULL DEFAULT '0',
  "reservedBnb" TEXT NOT NULL DEFAULT '0',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardPool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PoolFundingEvent" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "amountBnb" TEXT NOT NULL,
  "reference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "simulated" BOOLEAN NOT NULL DEFAULT false,
  "confirmedBy" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "note" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoolFundingEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PoolFundingEvent_status_idx" ON "PoolFundingEvent"("status");

CREATE TABLE IF NOT EXISTS "SettlementRecord" (
  "id" TEXT NOT NULL,
  "payoutId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountBnb" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "settledBy" TEXT,
  "txHash" TEXT,
  "note" TEXT,
  CONSTRAINT "SettlementRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SettlementRecord_payoutId_key" ON "SettlementRecord"("payoutId");
CREATE INDEX IF NOT EXISTS "SettlementRecord_userId_idx" ON "SettlementRecord"("userId");