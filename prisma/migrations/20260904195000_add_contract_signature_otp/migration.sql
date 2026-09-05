ALTER TYPE "ContractEvidenceType" ADD VALUE 'SIGNATURE_OTP_REQUESTED';
ALTER TYPE "ContractEvidenceType" ADD VALUE 'SIGNATURE_OTP_SENT';
ALTER TYPE "ContractEvidenceType" ADD VALUE 'SIGNATURE_OTP_FAILED';
ALTER TYPE "ContractEvidenceType" ADD VALUE 'SIGNATURE_OTP_VERIFIED';
ALTER TYPE "ContractEvidenceType" ADD VALUE 'SIGNATURE_OTP_EXPIRED';
ALTER TYPE "ContractEvidenceType" ADD VALUE 'SIGNATURE_OTP_CONSUMED';

CREATE TABLE "ContractSignatureOtp" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "contratoId" TEXT,
    "eventoContratoId" TEXT,
    "cpf" TEXT NOT NULL,
    "emailSnapshot" TEXT NOT NULL,
    "contractHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "verificationTokenHash" TEXT,
    "requestedIp" TEXT,
    "requestedUserAgent" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractSignatureOtp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContractSignatureOtp_resource_check" CHECK (
      ("contratoId" IS NOT NULL AND "eventoContratoId" IS NULL)
      OR ("contratoId" IS NULL AND "eventoContratoId" IS NOT NULL)
    )
);

CREATE INDEX "idx_contract_signature_otp_conta_contrato_created"
  ON "ContractSignatureOtp"("contaId", "contratoId", "createdAt");

CREATE INDEX "idx_contract_signature_otp_conta_evento_created"
  ON "ContractSignatureOtp"("contaId", "eventoContratoId", "createdAt");

CREATE INDEX "idx_contract_signature_otp_conta_cpf_created"
  ON "ContractSignatureOtp"("contaId", "cpf", "createdAt");

CREATE INDEX "idx_contract_signature_otp_expires"
  ON "ContractSignatureOtp"("expiresAt");

ALTER TABLE "ContractSignatureOtp"
  ADD CONSTRAINT "ContractSignatureOtp_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractSignatureOtp"
  ADD CONSTRAINT "ContractSignatureOtp_contratoId_fkey"
  FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractSignatureOtp"
  ADD CONSTRAINT "ContractSignatureOtp_eventoContratoId_fkey"
  FOREIGN KEY ("eventoContratoId") REFERENCES "EventoContrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
