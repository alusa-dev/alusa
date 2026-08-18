-- Pagamentos manuais já realizados são receitas históricas, nunca cobranças
-- em aberto. Corrige registros criados antes da transição de cancelamento
-- preservar o status RECEIVED.
UPDATE "EventFinancialEntry"
SET
  "status" = 'RECEIVED',
  "realizedAt" = COALESCE("realizedAt", "dueDate", "createdAt"),
  "netAmount" = COALESCE("netAmount", "actualAmount")
WHERE
  "status" = 'PENDING'
  AND "actualAmount" IS NOT NULL
  AND "actualAmount" > 0
  AND "asaasPaymentId" IS NULL
  AND ("paymentProvider" IS NULL OR "paymentProvider" <> 'ASAAS')
  AND "paymentMethod" IN ('CASH', 'MANUAL_PIX', 'EXTERNAL_CARD', 'TRANSFER');
