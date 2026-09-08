-- FAILED represents a known/compensated terminal attempt. It must not keep
-- reserving a family group for a new enrollment intent. Remote uncertainty is
-- represented by REQUIRES_RECONCILIATION and remains an active lock.
DROP INDEX IF EXISTS "uq_family_enrollment_operation_active";

CREATE UNIQUE INDEX "uq_family_enrollment_operation_active"
  ON "FamilyEnrollmentOperation"("contaId", "familyGroupId")
  WHERE "status" IN ('PENDING', 'PROCESSING', 'REQUIRES_RECONCILIATION');
