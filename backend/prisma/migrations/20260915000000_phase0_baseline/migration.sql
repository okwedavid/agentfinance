-- Phase 0 baseline migration.
--
-- This mirrors the schema that was previously applied via `prisma db push`
-- (non-destructive / idempotent) and ADDS the Phase 0 columns:
--   User.role  (server-authoritative role, default 'USER')
--   User.email (optional, unique)
--   FactoryRun.userId (resource ownership for user scoping)
--
-- Safe for both:
--   1. a fresh deployment (tables are created with the final shape), and
--   2. an existing database that was created by `prisma db push`
--      (CREATE TABLE IF NOT EXISTS is a no-op, ALTER ADD COLUMN IF NOT EXISTS
--      applies only the new columns). No destructive steps are used.

-- Tables that others reference must exist first.

CREATE TABLE IF NOT EXISTS "TaskAnalytics" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAnalytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "displayName" TEXT,
    "bio" TEXT,
    "walletAddress" TEXT,
    "walletProfiles" JSONB,
    "preferredNetwork" TEXT DEFAULT 'ethereum',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "input" TEXT,
    "status" TEXT DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "result" TEXT,
    "archived" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Task_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "sender" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Message_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CoordinatorTask" (
    "id" TEXT NOT NULL,
    "rootTaskId" TEXT,
    "agentId" TEXT,
    "status" TEXT DEFAULT 'pending',
    "plan" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoordinatorTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SubTask" (
    "id" TEXT NOT NULL,
    "coordinatorId" TEXT,
    "taskId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT DEFAULT 'pending',
    "attempts" INTEGER DEFAULT 0,
    "maxAttempts" INTEGER DEFAULT 3,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubTask_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "CoordinatorTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TokenUsage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Payout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "network" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "treasuryAddress" TEXT,
    "status" TEXT DEFAULT 'draft',
    "summary" TEXT,
    "approvalToken" TEXT,
    "unsignedPayload" JSONB,
    "signedPayload" JSONB,
    "txHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "broadcastAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DigitalProduct" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outcome" TEXT,
    "tagline" TEXT,
    "avatar" TEXT,
    "pain" TEXT,
    "dreamOutcome" TEXT,
    "price" INTEGER DEFAULT 49,
    "priceTiers" JSONB,
    "keywords" JSONB,
    "bundleWith" JSONB,
    "modules" JSONB,
    "deliverables" JSONB,
    "differentiation" TEXT,
    "status" TEXT DEFAULT 'draft',
    "evaluation" JSONB,
    "files" JSONB,
    "publishingAssets" JSONB,
    "internal" JSONB,
    "manifest" JSONB,
    "ecommerce" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigitalProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FactoryRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "batchSize" INTEGER DEFAULT 1,
    "approvedCount" INTEGER DEFAULT 0,
    "rejectedCount" INTEGER DEFAULT 0,
    "products" JSONB,
    "status" TEXT DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    CONSTRAINT "FactoryRun_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "DigitalProduct_slug_key" ON "DigitalProduct"("slug");

-- Phase 0 additive columns for databases that were previously created via
-- `prisma db push` (the CREATE TABLE statements above are no-ops there).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "FactoryRun" ADD COLUMN IF NOT EXISTS "userId" TEXT;