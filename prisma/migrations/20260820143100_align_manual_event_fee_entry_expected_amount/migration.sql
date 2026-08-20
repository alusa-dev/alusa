-- A taxa de inscrição é o valor total devido. Pagamentos manuais são baixas
-- parciais e não devem substituir o valor esperado do lançamento.
UPDATE "EventFinancialEntry" AS entry
SET "expectedAmount" = participant."registrationFeeCharged"
FROM "EventParticipant" AS participant
WHERE participant."contaId" = entry."contaId"
  AND participant."revenueEntryId" = entry."id"
  AND entry."paymentProvider" IS DISTINCT FROM 'ASAAS'
  AND participant."asaasPaymentId" IS NULL
  AND participant."asaasInstallmentId" IS NULL;
