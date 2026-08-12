ALTER TABLE "EventParticipant"
  ADD COLUMN "standaloneChargeId" TEXT,
  ADD COLUMN "asaasPaymentId" TEXT,
  ADD COLUMN "asaasInstallmentId" TEXT;

CREATE INDEX "idx_event_participant_conta_standalone_charge"
  ON "EventParticipant"("contaId", "standaloneChargeId");

CREATE INDEX "idx_event_participant_conta_asaas_payment"
  ON "EventParticipant"("contaId", "asaasPaymentId");

CREATE INDEX "idx_event_participant_conta_asaas_installment"
  ON "EventParticipant"("contaId", "asaasInstallmentId");
