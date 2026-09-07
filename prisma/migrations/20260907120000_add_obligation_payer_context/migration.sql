-- Persist the payer of the obligation separately from Customer's historical role.
-- All columns are nullable so legacy records with ambiguous ownership remain
-- safe and are not assigned arbitrarily.
ALTER TABLE "Charge" ADD COLUMN "payerType" "CustomerPayerType";
ALTER TABLE "Charge" ADD COLUMN "payerId" TEXT;

ALTER TABLE "StandaloneInstallmentPlan" ADD COLUMN "payerType" "CustomerPayerType";
ALTER TABLE "StandaloneInstallmentPlan" ADD COLUMN "payerId" TEXT;

ALTER TABLE "StandaloneSubscription" ADD COLUMN "payerType" "CustomerPayerType";
ALTER TABLE "StandaloneSubscription" ADD COLUMN "payerId" TEXT;

ALTER TABLE "ChargeReadModel" ADD COLUMN "payerType" "CustomerPayerType";
ALTER TABLE "ChargeReadModel" ADD COLUMN "payerId" TEXT;
ALTER TABLE "FinanceInstallmentPlanReadModel" ADD COLUMN "payerType" "CustomerPayerType";
ALTER TABLE "FinanceInstallmentPlanReadModel" ADD COLUMN "payerId" TEXT;
ALTER TABLE "FinanceSubscriptionReadModel" ADD COLUMN "payerType" "CustomerPayerType";
ALTER TABLE "FinanceSubscriptionReadModel" ADD COLUMN "payerId" TEXT;

CREATE INDEX "idx_charge_conta_obligation_payer"
  ON "Charge" ("contaId", "payerType", "payerId");
CREATE INDEX "idx_standalone_installment_conta_obligation_payer"
  ON "StandaloneInstallmentPlan" ("contaId", "payerType", "payerId");
CREATE INDEX "idx_standalone_subscription_conta_obligation_payer"
  ON "StandaloneSubscription" ("contaId", "payerType", "payerId");
CREATE INDEX "idx_charge_read_model_conta_obligation_payer"
  ON "ChargeReadModel" ("contaId", "payerType", "payerId");
CREATE INDEX "idx_fin_installment_rm_conta_obligation_payer"
  ON "FinanceInstallmentPlanReadModel" ("contaId", "payerType", "payerId");
CREATE INDEX "idx_fin_subscription_rm_conta_obligation_payer"
  ON "FinanceSubscriptionReadModel" ("contaId", "payerType", "payerId");

-- 1. Existing agreements and family records are authoritative for subscriptions.
UPDATE "StandaloneSubscription" AS subscription
SET
  "payerType" = agreement."payerType",
  "payerId" = agreement."payerId"
FROM "BillingAgreement" AS agreement
WHERE subscription."payerType" IS NULL
  AND subscription."payerId" IS NULL
  AND agreement."contaId" = subscription."contaId"
  AND agreement.id = subscription."billingAgreementId"
  AND agreement."payerType" IS NOT NULL
  AND agreement."payerId" IS NOT NULL;

UPDATE "StandaloneSubscription" AS subscription
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "MatriculaFamiliar" AS family
WHERE subscription."payerType" IS NULL
  AND subscription."payerId" IS NULL
  AND subscription."contaId" = family."contaId"
  AND subscription."familyGroupId" = family.id;

UPDATE "StandaloneSubscription" AS subscription
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "RematriculaFamiliar" AS family
WHERE subscription."payerType" IS NULL
  AND subscription."payerId" IS NULL
  AND subscription."contaId" = family."contaId"
  AND subscription."familyGroupId" = family.id;

-- 2. Standalone installment plans can be attributed from an explicit sale.
WITH sale_candidates AS (
  SELECT
    sale."contaId",
    sale."standaloneInstallmentPlanId" AS plan_id,
    sale."customerType"::"CustomerPayerType" AS payer_type,
    CASE
      WHEN sale."customerType" = 'ALUNO' THEN sale."alunoId"
      WHEN sale."customerType" = 'RESPONSAVEL' THEN sale."responsavelId"
      ELSE NULL
    END AS payer_id
  FROM "Sale" AS sale
  WHERE sale."standaloneInstallmentPlanId" IS NOT NULL
    AND sale."customerType" IN ('ALUNO', 'RESPONSAVEL')
), unique_sale_candidates AS (
  SELECT "contaId", plan_id, MIN(payer_type::text)::"CustomerPayerType" AS payer_type, MIN(payer_id) AS payer_id
  FROM sale_candidates
  WHERE payer_id IS NOT NULL
  GROUP BY "contaId", plan_id
  HAVING COUNT(DISTINCT payer_type::text || ':' || payer_id) = 1
)
UPDATE "StandaloneInstallmentPlan" AS plan
SET "payerType" = candidate.payer_type, "payerId" = candidate.payer_id
FROM unique_sale_candidates AS candidate
WHERE plan."contaId" = candidate."contaId"
  AND plan.id = candidate.plan_id
  AND plan."payerType" IS NULL
  AND plan."payerId" IS NULL;

-- 3. Charges inherit only explicit obligation context from their parent.
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
SET "payerType" = plan."payerType", "payerId" = plan."payerId"
FROM "StandaloneInstallmentPlan" AS plan
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = plan."contaId"
  AND charge."standaloneInstallmentPlanId" = plan.id
  AND plan."payerType" IS NOT NULL
  AND plan."payerId" IS NOT NULL;

-- 4. Academic charges use the matrícula's explicit financial responsible or
-- the student. This never consults Customer's historical role.
UPDATE "Charge" AS charge
SET
  "payerType" = CASE
    WHEN enrollment."responsavelFinanceiroId" IS NOT NULL THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END,
  "payerId" = COALESCE(enrollment."responsavelFinanceiroId", enrollment."alunoId")
FROM "Cobranca" AS bill
JOIN "Matricula" AS enrollment
  ON enrollment."contaId" = bill."contaId"
 AND enrollment.id = bill."matriculaId"
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = bill."contaId"
  AND charge."cobrancaId" = bill.id;

-- Family context is explicit even when the individual charge is not linked to
-- a Cobranca row.
UPDATE "Charge" AS charge
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "MatriculaFamiliar" AS family
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = family."contaId"
  AND charge."familyGroupId" = family.id;

UPDATE "Charge" AS charge
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "MatriculaFamiliar" AS family
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = family."contaId"
  AND charge.id = family."standaloneEnrollmentChargeId";

UPDATE "Charge" AS charge
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "RematriculaFamiliar" AS family
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
  AND charge.id = family."standaloneEnrollmentChargeId";

-- 5. Sale ownership is explicit and deterministic. Ambiguous/multiple sales
-- are deliberately left untouched.
WITH sale_candidates AS (
  SELECT
    sale."contaId",
    sale."chargeId" AS charge_id,
    sale."customerType"::"CustomerPayerType" AS payer_type,
    CASE
      WHEN sale."customerType" = 'ALUNO' THEN sale."alunoId"
      WHEN sale."customerType" = 'RESPONSAVEL' THEN sale."responsavelId"
      ELSE NULL
    END AS payer_id
  FROM "Sale" AS sale
  WHERE sale."chargeId" IS NOT NULL
    AND sale."customerType" IN ('ALUNO', 'RESPONSAVEL')
), unique_sale_candidates AS (
  SELECT "contaId", charge_id, MIN(payer_type::text)::"CustomerPayerType" AS payer_type, MIN(payer_id) AS payer_id
  FROM sale_candidates
  WHERE payer_id IS NOT NULL
  GROUP BY "contaId", charge_id
  HAVING COUNT(DISTINCT payer_type::text || ':' || payer_id) = 1
)
UPDATE "Charge" AS charge
SET "payerType" = candidate.payer_type, "payerId" = candidate.payer_id
FROM unique_sale_candidates AS candidate
WHERE charge."contaId" = candidate."contaId"
  AND charge.id = candidate.charge_id
  AND charge."payerType" IS NULL
  AND charge."payerId" IS NULL;

-- 6. Only a single historical Customer alias is safe as a final compatibility
-- fallback. Shared identities remain NULL when there is more than one role.
WITH roles AS (
  SELECT "contaId", id AS customer_id, "payerType", "payerId"
  FROM "Customer"
  UNION
  SELECT "contaId", "customerId", "payerType", "payerId"
  FROM "CustomerPayer"
), sole_roles AS (
  SELECT "contaId", customer_id, MIN("payerType"::text)::"CustomerPayerType" AS payer_type, MIN("payerId") AS payer_id
  FROM roles
  GROUP BY "contaId", customer_id
  HAVING COUNT(*) = 1
)
UPDATE "StandaloneSubscription" AS subscription
SET "payerType" = role.payer_type, "payerId" = role.payer_id
FROM sole_roles AS role
WHERE subscription."payerType" IS NULL
  AND subscription."payerId" IS NULL
  AND subscription."contaId" = role."contaId"
  AND subscription."customerId" = role.customer_id;

WITH roles AS (
  SELECT "contaId", id AS customer_id, "payerType", "payerId"
  FROM "Customer"
  UNION
  SELECT "contaId", "customerId", "payerType", "payerId"
  FROM "CustomerPayer"
), sole_roles AS (
  SELECT "contaId", customer_id, MIN("payerType"::text)::"CustomerPayerType" AS payer_type, MIN("payerId") AS payer_id
  FROM roles
  GROUP BY "contaId", customer_id
  HAVING COUNT(*) = 1
)
UPDATE "StandaloneInstallmentPlan" AS plan
SET "payerType" = role.payer_type, "payerId" = role.payer_id
FROM sole_roles AS role
WHERE plan."payerType" IS NULL
  AND plan."payerId" IS NULL
  AND plan."contaId" = role."contaId"
  AND plan."customerId" = role.customer_id;

WITH roles AS (
  SELECT "contaId", id AS customer_id, "payerType", "payerId"
  FROM "Customer"
  UNION
  SELECT "contaId", "customerId", "payerType", "payerId"
  FROM "CustomerPayer"
), sole_roles AS (
  SELECT "contaId", customer_id, MIN("payerType"::text)::"CustomerPayerType" AS payer_type, MIN("payerId") AS payer_id
  FROM roles
  GROUP BY "contaId", customer_id
  HAVING COUNT(*) = 1
)
UPDATE "Charge" AS charge
SET "payerType" = role.payer_type, "payerId" = role.payer_id
FROM sole_roles AS role
WHERE charge."payerType" IS NULL
  AND charge."payerId" IS NULL
  AND charge."contaId" = role."contaId"
  AND charge."customerId" = role.customer_id;

-- Refresh existing read-model rows without broadening ownership. The source
-- tables above are authoritative; rows left NULL are intentionally unresolved.
UPDATE "ChargeReadModel" AS model
SET "payerType" = charge."payerType", "payerId" = charge."payerId"
FROM "Charge" AS charge
WHERE model."contaId" = charge."contaId"
  AND model."sourceKind" = 'CHARGE'
  AND model."sourceId" = charge.id;

UPDATE "ChargeReadModel" AS model
SET
  "payerType" = CASE
    WHEN enrollment."responsavelFinanceiroId" IS NOT NULL THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END,
  "payerId" = COALESCE(enrollment."responsavelFinanceiroId", enrollment."alunoId")
FROM "Cobranca" AS bill
JOIN "Matricula" AS enrollment
  ON enrollment."contaId" = bill."contaId"
 AND enrollment.id = bill."matriculaId"
WHERE model."contaId" = bill."contaId"
  AND model."sourceKind" = 'COBRANCA'
  AND model."sourceId" = bill.id;

UPDATE "FinanceSubscriptionReadModel" AS model
SET "payerType" = subscription."payerType", "payerId" = subscription."payerId"
FROM "StandaloneSubscription" AS subscription
WHERE model."contaId" = subscription."contaId"
  AND model."sourceKind" = 'STANDALONE_SUBSCRIPTION'
  AND model."sourceId" = subscription.id;

UPDATE "FinanceInstallmentPlanReadModel" AS model
SET "payerType" = plan."payerType", "payerId" = plan."payerId"
FROM "StandaloneInstallmentPlan" AS plan
WHERE model."contaId" = plan."contaId"
  AND model."sourceKind" = 'STANDALONE_INSTALLMENT'
  AND model."sourceId" = plan.id;
