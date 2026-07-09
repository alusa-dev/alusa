CREATE UNIQUE INDEX IF NOT EXISTS "uq_family_fin_alloc_identity_null_subscription"
  ON "FamilyFinancialAllocation"("contaId", "matriculaId", "chargeKind", "competenceStart")
  WHERE "standaloneSubscriptionId" IS NULL AND "matriculaId" IS NOT NULL;
