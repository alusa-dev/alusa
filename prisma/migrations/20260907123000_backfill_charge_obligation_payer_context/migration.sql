-- Complete the obligation-payer backfill after family installment plans have
-- received their explicit payer. All statements are idempotent and preserve
-- NULL for records whose ownership is still ambiguous.
UPDATE "Charge" AS charge
SET "payerType" = plan."payerType", "payerId" = plan."payerId"
FROM "StandaloneInstallmentPlan" AS plan
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = plan."contaId"
  AND charge."standaloneInstallmentPlanId" = plan.id
  AND plan."payerType" IS NOT NULL
  AND plan."payerId" IS NOT NULL;

UPDATE "Charge" AS charge
SET "payerType" = subscription."payerType", "payerId" = subscription."payerId"
FROM "StandaloneSubscription" AS subscription
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = subscription."contaId"
  AND charge."standaloneSubscriptionId" = subscription.id
  AND subscription."payerType" IS NOT NULL
  AND subscription."payerId" IS NOT NULL;

UPDATE "Charge" AS charge
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "MatriculaFamiliar" AS family
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = family."contaId"
  AND charge."familyGroupId" = family.id;

UPDATE "Charge" AS charge
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "RematriculaFamiliar" AS family
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = family."contaId"
  AND charge."familyGroupId" = family.id;

-- The linked Charge is the obligation source when a legacy academic charge
-- already has explicit payer context. Otherwise the enrollment's financial
-- responsible/student remains the deterministic fallback.
UPDATE "ChargeReadModel" AS model
SET
  "payerType" = COALESCE(linked."payerType", CASE
    WHEN enrollment."responsavelFinanceiroId" IS NOT NULL THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END),
  "payerId" = COALESCE(linked."payerId", COALESCE(enrollment."responsavelFinanceiroId", enrollment."alunoId"))
FROM "Cobranca" AS bill
JOIN "Matricula" AS enrollment
  ON enrollment."contaId" = bill."contaId"
 AND enrollment.id = bill."matriculaId"
LEFT JOIN "Charge" AS linked
  ON linked."contaId" = bill."contaId"
 AND linked."cobrancaId" = bill.id
WHERE model."contaId" = bill."contaId"
  AND model."sourceKind" = 'COBRANCA'
  AND model."sourceId" = bill.id;

UPDATE "ChargeReadModel" AS model
SET "payerType" = charge."payerType", "payerId" = charge."payerId"
FROM "Charge" AS charge
WHERE model."contaId" = charge."contaId"
  AND model."sourceKind" = 'CHARGE'
  AND model."sourceId" = charge.id;

UPDATE "FinanceInstallmentPlanReadModel" AS model
SET "payerType" = plan."payerType", "payerId" = plan."payerId"
FROM "StandaloneInstallmentPlan" AS plan
WHERE model."contaId" = plan."contaId"
  AND model."sourceKind" = 'STANDALONE_INSTALLMENT'
  AND model."sourceId" = plan.id;

UPDATE "FinanceSubscriptionReadModel" AS model
SET "payerType" = subscription."payerType", "payerId" = subscription."payerId"
FROM "StandaloneSubscription" AS subscription
WHERE model."contaId" = subscription."contaId"
  AND model."sourceKind" = 'STANDALONE_SUBSCRIPTION'
  AND model."sourceId" = subscription.id;
