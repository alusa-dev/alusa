-- Existing manual cost payments were backfilled as RECEIVED by the original
-- ledger migration. Give them the correct outgoing-payment meaning.
UPDATE "EventFinancialPayment" payment
SET "status" = 'PAID'::"EventFinancialPaymentStatus"
FROM "EventFinancialEntry" entry
WHERE payment."financialEntryId" = entry."id"
  AND payment."contaId" = entry."contaId"
  AND entry."type" = 'COST'
  AND payment."status" = 'RECEIVED';

-- A legacy cost could be marked paid after an amount smaller than its expected
-- total. Reclassify it without creating another ledger payment.
UPDATE "EventFinancialEntry"
SET "status" = 'PARTIALLY_PAID'::"EventFinancialEntryStatus"
WHERE "type" = 'COST'
  AND "originType" = 'MANUAL'
  AND "status" = 'PAID'
  AND "actualAmount" > 0
  AND "actualAmount" < "expectedAmount";
