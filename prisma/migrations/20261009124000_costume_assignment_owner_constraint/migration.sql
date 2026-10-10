-- Preserve pre-existing group rows for review; new or updated active links must
-- be individual student assignments. Existing group rows are deliberately not
-- validated so their stock/payment history is not rewritten implicitly.
ALTER TABLE "EventCostumeAssignment"
ADD CONSTRAINT "chk_event_costume_assignment_active_owner"
CHECK (
  "status" = 'CANCELLED'
  OR ("alunoId" IS NOT NULL AND "turmaId" IS NULL)
) NOT VALID;
