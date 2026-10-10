ALTER TYPE "EventFinancialOriginType" ADD VALUE IF NOT EXISTS 'EVENT_REGISTRATION';

CREATE INDEX IF NOT EXISTS "idx_event_participant_conta_revenue_entry"
ON "EventParticipant"("contaId", "revenueEntryId");
