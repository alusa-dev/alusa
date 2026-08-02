-- Outboxes financeiros são trilha auditável. A remoção da entidade de origem
-- deve ser lógica; nunca apagar eventos financeiros por cascata.
ALTER TABLE "MatriculaBillingOutbox"
  DROP CONSTRAINT IF EXISTS "MatriculaBillingOutbox_contaId_matriculaId_fkey";
ALTER TABLE "MatriculaBillingOutbox"
  ADD CONSTRAINT "MatriculaBillingOutbox_contaId_matriculaId_fkey"
  FOREIGN KEY ("contaId", "matriculaId")
  REFERENCES "Matricula"("contaId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FamilyBillingOutbox"
  DROP CONSTRAINT IF EXISTS "FamilyBillingOutbox_contaId_matriculaFamiliarId_fkey";
ALTER TABLE "FamilyBillingOutbox"
  DROP CONSTRAINT IF EXISTS "FamilyBillingOutbox_contaId_rematriculaFamiliarId_fkey";
ALTER TABLE "FamilyBillingOutbox"
  ADD CONSTRAINT "FamilyBillingOutbox_contaId_matriculaFamiliarId_fkey"
  FOREIGN KEY ("contaId", "matriculaFamiliarId")
  REFERENCES "MatriculaFamiliar"("contaId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyBillingOutbox"
  ADD CONSTRAINT "FamilyBillingOutbox_contaId_rematriculaFamiliarId_fkey"
  FOREIGN KEY ("contaId", "rematriculaFamiliarId")
  REFERENCES "RematriculaFamiliar"("contaId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
