-- Reconcilia pagamentos manuais de eventos já registrados.
-- O valor bruto continua no lançamento para fins de auditoria, enquanto os snapshots
-- do participante usam somente o saldo líquido após estornos.

WITH payment_totals AS (
  SELECT
    "contaId",
    "financialEntryId",
    "participantId",
    SUM("amount") AS gross_amount,
    SUM("refundedAmount") AS refunded_amount,
    SUM(
      CASE
        WHEN "status" = 'REFUNDED' THEN 0
        ELSE GREATEST("amount" - "refundedAmount", 0)
      END
    ) AS net_amount
  FROM "EventFinancialPayment"
  WHERE "participantId" IS NOT NULL
  GROUP BY "contaId", "financialEntryId", "participantId"
)
UPDATE "EventFinancialEntry" AS entry
SET
  "actualAmount" = totals.gross_amount,
  "refundedAmount" = totals.refunded_amount,
  "netAmount" = totals.net_amount,
  "status" = CASE
    WHEN totals.net_amount <= 0 AND totals.gross_amount > 0 THEN 'REFUNDED'::"EventFinancialEntryStatus"
    WHEN totals.refunded_amount > 0 THEN 'PARTIALLY_REFUNDED'::"EventFinancialEntryStatus"
    WHEN totals.net_amount >= participant."registrationFeeCharged" AND participant."registrationFeeCharged" > 0 THEN 'RECEIVED'::"EventFinancialEntryStatus"
    ELSE 'PENDING'::"EventFinancialEntryStatus"
  END
FROM payment_totals AS totals
JOIN "EventParticipant" AS participant
  ON participant."id" = totals."participantId"
  AND participant."contaId" = totals."contaId"
WHERE entry."id" = totals."financialEntryId"
  AND entry."contaId" = totals."contaId";

WITH payment_totals AS (
  SELECT
    "contaId",
    "financialEntryId",
    "participantId",
    SUM("amount") AS gross_amount,
    SUM("refundedAmount") AS refunded_amount,
    SUM(
      CASE
        WHEN "status" = 'REFUNDED' THEN 0
        ELSE GREATEST("amount" - "refundedAmount", 0)
      END
    ) AS net_amount
  FROM "EventFinancialPayment"
  WHERE "participantId" IS NOT NULL
  GROUP BY "contaId", "financialEntryId", "participantId"
)
UPDATE "EventParticipant" AS participant
SET
  "isFeePaid" = totals.net_amount >= participant."registrationFeeCharged"
    AND participant."registrationFeeCharged" > 0,
  "feePaidAmount" = totals.net_amount,
  "feeRefundedAmount" = totals.refunded_amount,
  "entryAmount" = totals.net_amount,
  "balanceAmount" = GREATEST(participant."registrationFeeCharged" - totals.net_amount, 0),
  "financialStatusSnapshot" = CASE
    WHEN totals.net_amount >= participant."registrationFeeCharged" AND participant."registrationFeeCharged" > 0 THEN 'QUITADO'
    WHEN totals.net_amount <= 0 AND totals.gross_amount > 0 THEN 'ESTORNADO'
    WHEN totals.refunded_amount > 0 THEN 'ESTORNADO_PARCIAL'
    WHEN totals.net_amount > 0 THEN 'EM_DIA'
    ELSE 'PENDENTE'
  END
FROM payment_totals AS totals
WHERE participant."id" = totals."participantId"
  AND participant."contaId" = totals."contaId"
  AND participant."revenueEntryId" = totals."financialEntryId";
