-- Add the approved school pricing bands without rewriting existing billing rows.
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_001_025';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_026_050';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_051_100';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_101_150';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_151_200';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_201_300';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_301_400';
ALTER TYPE "PlatformBillingPlanCode" ADD VALUE IF NOT EXISTS 'BAND_401_500';

CREATE TYPE "PlatformBillingPriceBand" AS ENUM (
  'BAND_001_025',
  'BAND_026_050',
  'BAND_051_100',
  'BAND_101_150',
  'BAND_151_200',
  'BAND_201_300',
  'BAND_301_400',
  'BAND_401_500',
  'SPECIALIST'
);

CREATE TABLE "PlatformBillingMonthlySnapshot" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "billingAccountId" TEXT,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "periodStart" DATE NOT NULL,
  "studentCount" INTEGER NOT NULL,
  "candidateBand" "PlatformBillingPriceBand",
  "specialistRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformBillingMonthlySnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformBillingMonthlySnapshot_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlatformBillingMonthlySnapshot_billingAccountId_fkey"
    FOREIGN KEY ("billingAccountId") REFERENCES "PlatformBillingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlatformBillingMonthlySnapshot_studentCount_check" CHECK ("studentCount" >= 0)
);

CREATE UNIQUE INDEX "uq_platform_billing_monthly_snapshot_conta_env_period"
  ON "PlatformBillingMonthlySnapshot"("contaId", "environment", "periodStart");
CREATE INDEX "idx_platform_billing_monthly_snapshot_candidate"
  ON "PlatformBillingMonthlySnapshot"("contaId", "environment", "candidateBand", "periodStart");
CREATE INDEX "idx_platform_billing_monthly_snapshot_account_period"
  ON "PlatformBillingMonthlySnapshot"("billingAccountId", "periodStart");

ALTER TABLE public."PlatformBillingMonthlySnapshot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public."PlatformBillingMonthlySnapshot"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
