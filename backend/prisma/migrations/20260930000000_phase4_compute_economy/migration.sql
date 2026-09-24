-- Phase 4 compute-to-revenue economy.
--
-- Purely additive. No drops, no data rewrites. The first slice wires
-- Compute-as-a-Service: ServiceCatalog -> ComputeQuote -> PaymentIntent ->
-- RevenueEvent -> RevenueAllocation -> RewardPool funding -> RewardEvent ->
-- UserRewardBalance (via the existing settleable pipeline).
--
-- RewardEvent is extended additively: "taskId" becomes nullable (task and
-- compute rewards both live here; compute rewards are keyed by "computeJobId"
-- unique instead) and a new nullable unique "computeJobId" column is added.

ALTER TABLE "RewardEvent" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "RewardEvent" ADD COLUMN IF NOT EXISTS "computeJobId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "RewardEvent_computeJobId_key" ON "RewardEvent"("computeJobId");

CREATE TABLE IF NOT EXISTS "ServiceCatalog" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "agent" TEXT NOT NULL DEFAULT 'general',
  "unitPriceBnb" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'compute',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceCatalog_slug_key" ON "ServiceCatalog"("slug");

CREATE TABLE IF NOT EXISTS "ComputeQuote" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestText" TEXT,
  "asset" TEXT NOT NULL DEFAULT 'BNB',
  "amountWei" TEXT NOT NULL,
  "priceBnbWei" TEXT NOT NULL,
  "priceBnbPerUnit" TEXT,
  "platformFeeBnbWei" TEXT NOT NULL,
  "serviceCostBnbWei" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComputeQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ComputeQuote_nonce_key" ON "ComputeQuote"("nonce");
CREATE INDEX IF NOT EXISTS "ComputeQuote_userId_idx" ON "ComputeQuote"("userId");
CREATE INDEX IF NOT EXISTS "ComputeQuote_serviceId_idx" ON "ComputeQuote"("serviceId");

CREATE TABLE IF NOT EXISTS "PaymentIntent" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "amountWei" TEXT NOT NULL,
  "priceBnbPerUnit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "verificationType" TEXT NOT NULL DEFAULT 'MANUAL_CERT',
  "external" BOOLEAN NOT NULL DEFAULT true,
  "txHash" TEXT,
  "payerLabel" TEXT,
  "customerId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "settledAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentIntent_quoteId_key" ON "PaymentIntent"("quoteId");

CREATE TABLE IF NOT EXISTS "ComputeCustomer" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "external" BOOLEAN NOT NULL DEFAULT false,
  "creditsPaid" INTEGER NOT NULL DEFAULT 0,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComputeCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ComputeJob" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "sellerUserId" TEXT NOT NULL,
  "inputText" TEXT,
  "agent" TEXT NOT NULL DEFAULT 'general',
  "taskId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "expectedPriceBnbWei" TEXT NOT NULL,
  "economicValueBnb" TEXT NOT NULL DEFAULT '0',
  "revenueEventId" TEXT,
  "failureReason" TEXT,
  "failureType" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComputeJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ComputeJob_sellerUserId_idx" ON "ComputeJob"("sellerUserId");
CREATE INDEX IF NOT EXISTS "ComputeJob_serviceId_idx" ON "ComputeJob"("serviceId");
CREATE INDEX IF NOT EXISTS "ComputeJob_status_idx" ON "ComputeJob"("status");

CREATE TABLE IF NOT EXISTS "ComputeOutput" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "resultText" TEXT NOT NULL,
  "resultHash" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "engine" TEXT NOT NULL DEFAULT 'agent-fleet',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComputeOutput_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ComputeOutput_jobId_key" ON "ComputeOutput"("jobId");

CREATE TABLE IF NOT EXISTS "ComputeCost" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "costAsset" TEXT NOT NULL DEFAULT 'BNB',
  "amountWei" TEXT NOT NULL,
  "costKind" TEXT NOT NULL DEFAULT 'INFERENCE',
  "source" TEXT NOT NULL DEFAULT 'INTERNAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComputeCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ComputeCost_jobId_idx" ON "ComputeCost"("jobId");

CREATE TABLE IF NOT EXISTS "RevenueEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "amountWei" TEXT NOT NULL,
  "bnbEquivalentWei" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'COMPUTE_JOB',
  "monetizerType" TEXT NOT NULL DEFAULT 'CUSTOMER_PAYMENT',
  "external" BOOLEAN NOT NULL DEFAULT true,
  "simulated" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'BOOKED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevenueEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RevenueEvent_jobId_idx" ON "RevenueEvent"("jobId");
-- Unique: a paymentIntent can be booked at most once (idempotent verification);
-- this is the DB-level guard behind the P2002 path in revenueService.
CREATE UNIQUE INDEX IF NOT EXISTS "RevenueEvent_paymentIntentId_key" ON "RevenueEvent"("paymentIntentId");

CREATE TABLE IF NOT EXISTS "RevenueAllocation" (
  "id" TEXT NOT NULL,
  "revenueEventId" TEXT NOT NULL,
  "allocationType" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "amountWei" TEXT NOT NULL,
  "bnbEquivalentWei" TEXT NOT NULL,
  "simulated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevenueAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RevenueAllocation_revenueEventId_idx" ON "RevenueAllocation"("revenueEventId");
CREATE INDEX IF NOT EXISTS "RevenueAllocation_allocationType_idx" ON "RevenueAllocation"("allocationType");