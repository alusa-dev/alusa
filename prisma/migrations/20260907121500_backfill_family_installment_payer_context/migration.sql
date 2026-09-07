-- Backfill the explicit payer for family installment plans from the family
-- record itself. The operation is additive and idempotent; there is no safe
-- Customer-role fallback when a family plan has no explicit group context.
UPDATE "StandaloneInstallmentPlan" AS plan
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "MatriculaFamiliar" AS family
WHERE plan."payerType" IS NULL
  AND plan."payerId" IS NULL
  AND plan."contaId" = family."contaId"
  AND plan."familyGroupId" = family.id;

UPDATE "StandaloneInstallmentPlan" AS plan
SET "payerType" = 'RESPONSAVEL'::"CustomerPayerType", "payerId" = family."responsavelId"
FROM "RematriculaFamiliar" AS family
WHERE plan."payerType" IS NULL
  AND plan."payerId" IS NULL
  AND plan."contaId" = family."contaId"
  AND plan."familyGroupId" = family.id;
