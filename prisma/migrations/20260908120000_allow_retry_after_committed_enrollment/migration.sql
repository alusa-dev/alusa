-- A COMMITTED operation is a completed historical record, not an active
-- reservation of the enrollment intent. A cancelled enrollment must be able
-- to be created again with a new UI idempotency key and the same terms.
DROP INDEX IF EXISTS "uq_enrollment_creation_operation_nonretryable_fingerprint";

CREATE UNIQUE INDEX "uq_enrollment_creation_operation_nonretryable_fingerprint"
  ON "EnrollmentCreationOperation"("contaId", "requestFingerprint")
  WHERE "status" IN (
    'PENDING',
    'PROCESSING',
    'REMOTE_PROVISIONED',
    'COMPENSATING',
    'REQUIRES_RECONCILIATION'
  );
