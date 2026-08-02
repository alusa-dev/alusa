-- Saga durável para criação síncrona de matrícula e provisionamento financeiro.
-- A operação existe antes da Matricula e permanece como trilha auditável após o commit.

CREATE TYPE "EnrollmentCreationOperationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'REMOTE_PROVISIONED',
  'COMMITTED',
  'COMPENSATING',
  'COMPENSATED',
  'FAILED',
  'REQUIRES_RECONCILIATION'
);

CREATE TABLE "EnrollmentCreationOperation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "alunoId" TEXT NOT NULL,
  "matriculaId" TEXT,
  "uiRequestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "status" "EnrollmentCreationOperationStatus" NOT NULL DEFAULT 'PENDING',
  "requestSnapshot" JSONB NOT NULL,
  "result" JSONB,
  "asaasSubscriptionId" TEXT,
  "asaasFirstPaymentId" TEXT,
  "asaasEnrollmentFeePaymentId" TEXT,
  "actorId" TEXT,
  "lastError" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "remoteProvisionedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "compensatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EnrollmentCreationOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnrollmentCreationOperation_nonempty_keys_check" CHECK (
    length(btrim("uiRequestId")) > 0
    AND length(btrim("requestFingerprint")) > 0
    AND length(btrim("externalReference")) > 0
    AND length(btrim("correlationId")) > 0
  ),
  CONSTRAINT "EnrollmentCreationOperation_nonnegative_counters_check" CHECK (
    "attempts" >= 0 AND "version" >= 0
  ),
  CONSTRAINT "EnrollmentCreationOperation_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EnrollmentCreationOperation_contaId_alunoId_fkey"
    FOREIGN KEY ("contaId", "alunoId") REFERENCES "Aluno"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EnrollmentCreationOperation_contaId_matriculaId_fkey"
    FOREIGN KEY ("contaId", "matriculaId") REFERENCES "Matricula"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_enrollment_creation_operation_conta_id"
  ON "EnrollmentCreationOperation"("contaId", "id");
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_request"
  ON "EnrollmentCreationOperation"("contaId", "uiRequestId");
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_external_ref"
  ON "EnrollmentCreationOperation"("contaId", "externalReference");
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_matricula"
  ON "EnrollmentCreationOperation"("contaId", "matriculaId");
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_asaas_subscription"
  ON "EnrollmentCreationOperation"("contaId", "asaasSubscriptionId");
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_asaas_first_payment"
  ON "EnrollmentCreationOperation"("contaId", "asaasFirstPaymentId");
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_asaas_fee_payment"
  ON "EnrollmentCreationOperation"("contaId", "asaasEnrollmentFeePaymentId");

-- Impede duas sagas concorrentes ou uma segunda publicação da mesma intenção.
-- FAILED e COMPENSATED ficam fora para permitir nova tentativa comprovadamente segura.
CREATE UNIQUE INDEX "uq_enrollment_creation_operation_nonretryable_fingerprint"
  ON "EnrollmentCreationOperation"("contaId", "requestFingerprint")
  WHERE "status" IN (
    'PENDING',
    'PROCESSING',
    'REMOTE_PROVISIONED',
    'COMMITTED',
    'COMPENSATING',
    'REQUIRES_RECONCILIATION'
  );

CREATE INDEX "idx_enrollment_creation_operation_status_updated"
  ON "EnrollmentCreationOperation"("contaId", "status", "updatedAt");
CREATE INDEX "idx_enrollment_creation_operation_fingerprint_status"
  ON "EnrollmentCreationOperation"("contaId", "requestFingerprint", "status");
CREATE INDEX "idx_enrollment_creation_operation_aluno_created"
  ON "EnrollmentCreationOperation"("contaId", "alunoId", "createdAt");
CREATE INDEX "idx_enrollment_creation_operation_correlation"
  ON "EnrollmentCreationOperation"("contaId", "correlationId");
CREATE INDEX "idx_enrollment_creation_operation_lease"
  ON "EnrollmentCreationOperation"("contaId", "leaseExpiresAt");

COMMENT ON COLUMN "EnrollmentCreationOperation"."requestSnapshot" IS
  'Snapshot sanitizado da intenção; nunca armazenar cartão, token, API key ou credencial.';

ALTER TABLE "EnrollmentCreationOperation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EnrollmentCreationOperation"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
