-- Phase 0 — Agent Revenue Orchestrator: economic truth foundation.
--
-- ADDITIVE ONLY. No table is dropped, truncated, or rewritten. No existing row
-- is deleted and no historical amount is re-labelled as real revenue.
--
-- 1) PoolFundingEvent.fundingClass
--    Records WHERE pool funding actually came from, so operator-typed numbers
--    can never be represented as externally earned revenue.
--    Existing rows backfill to UNCLASSIFIED on purpose: we will not guess the
--    origin of historical funding.
--
-- 2) RevenueEvent.verificationMethod
--    Records HOW a revenue event was evidenced.
--    Backfilled from the originating PaymentIntent so history keeps its true
--    meaning (SIMULATED stays SIMULATED; legacy MANUAL_CERT becomes
--    OPERATOR_ASSERTED, because a self-issued HMAC is not external proof).
--    EXTERNAL_VERIFIED is never written by this migration.

-- AlterTable
ALTER TABLE "PoolFundingEvent" ADD COLUMN     "fundingClass" TEXT NOT NULL DEFAULT 'UNCLASSIFIED';

-- AlterTable
ALTER TABLE "RevenueEvent" ADD COLUMN     "verificationMethod" TEXT NOT NULL DEFAULT 'OPERATOR_ASSERTED';

-- Backfill: derive the true evidence class from the payment intent that produced
-- each revenue event. Rows whose intent is missing keep the conservative
-- OPERATOR_ASSERTED default rather than being promoted.
UPDATE "RevenueEvent" AS re
SET "verificationMethod" = CASE
  WHEN COALESCE(pi."verificationType", '') = 'SIMULATED' OR re."simulated" = TRUE
    THEN 'SIMULATED'
  ELSE 'OPERATOR_ASSERTED'
END
FROM "PaymentIntent" AS pi
WHERE pi."id" = re."paymentIntentId";

-- CreateIndex
CREATE INDEX "PoolFundingEvent_fundingClass_idx" ON "PoolFundingEvent"("fundingClass");

-- 3) ComputeJob.payerUserId
--    The job previously recorded only `sellerUserId`, and the customer route set
--    it to the quote owner — the very same party that paid. A customer who paid
--    for a job was then credited a reward funded by their own payment, so the
--    platform reported revenue it had merely taken in. Recording the payer
--    separately makes self-payment detectable instead of invisible.
--    Backfilled from the quote's owner, which is what the old code actually
--    stored. Historical rows are NOT relabelled as legitimate sales; they simply
--    become auditable.

-- AlterTable
ALTER TABLE "ComputeJob" ADD COLUMN     "payerUserId" TEXT;

-- Backfill: the old `sellerUserId` was written from the quote owner, so that is
-- the only payer identity the history contains.
UPDATE "ComputeJob" AS cj
SET "payerUserId" = cj."sellerUserId"
FROM "ComputeQuote" AS cq
WHERE cq."id" = cj."quoteId";

-- The historical `sellerUserId` values are the payer themselves, so they are NOT
-- trustworthy reward recipients. They are cleared rather than left in place,
-- which also lets the column become nullable. History is preserved: the rows and
-- their revenue events are untouched, and the payer identity is retained in
-- payerUserId. Going forward a job only carries a seller when a real
-- contributor is configured.
UPDATE "ComputeJob" SET "sellerUserId" = NULL WHERE "sellerUserId" = "payerUserId";

-- Make sellerUserId nullable: a job with no configured contributor performs work
-- and books revenue, but credits nobody.
ALTER TABLE "ComputeJob" ALTER COLUMN "sellerUserId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "RevenueEvent_verificationMethod_idx" ON "RevenueEvent"("verificationMethod");

-- CreateIndex
CREATE INDEX "ComputeJob_payerUserId_idx" ON "ComputeJob"("payerUserId");