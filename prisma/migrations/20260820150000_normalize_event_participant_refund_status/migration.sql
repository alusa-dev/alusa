-- Neste fluxo o participante usa apenas os estados básicos. Um estorno
-- continua no histórico, mas não cria um novo status de participante.
UPDATE "EventParticipant"
SET "financialStatusSnapshot" = CASE
  WHEN "feePaidAmount" > 0 THEN 'EM_DIA'
  ELSE 'ESTORNADO'
END
WHERE "financialStatusSnapshot" = 'ESTORNADO_PARCIAL';

UPDATE "EventFinancialEntry" AS entry
SET "status" = 'PENDING'::"EventFinancialEntryStatus"
FROM "EventParticipant" AS participant
WHERE participant."contaId" = entry."contaId"
  AND participant."revenueEntryId" = entry."id"
  AND participant."financialStatusSnapshot" = 'EM_DIA'
  AND entry."status" = 'PARTIALLY_REFUNDED'::"EventFinancialEntryStatus";
