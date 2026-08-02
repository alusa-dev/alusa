-- Falha de forma explícita antes de trocar as FKs caso exista corrupção
-- histórica. O reparo deve ser tenant-aware; nunca reatribuir silenciosamente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MatriculaBillingOutbox" o
    JOIN "Matricula" m ON m."id" = o."matriculaId"
    WHERE o."matriculaId" IS NOT NULL AND m."contaId" <> o."contaId"
  ) OR EXISTS (
    SELECT 1
    FROM "FamilyBillingOutbox" o
    JOIN "MatriculaFamiliar" m ON m."id" = o."matriculaFamiliarId"
    WHERE o."matriculaFamiliarId" IS NOT NULL AND m."contaId" <> o."contaId"
  ) OR EXISTS (
    SELECT 1
    FROM "FamilyBillingOutbox" o
    JOIN "RematriculaFamiliar" r ON r."id" = o."rematriculaFamiliarId"
    WHERE o."rematriculaFamiliarId" IS NOT NULL AND r."contaId" <> o."contaId"
  ) THEN
    RAISE EXCEPTION 'Cross-tenant billing outbox relation detected; reconcile rows before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_rematricula_familiar_conta_id"
  ON "RematriculaFamiliar"("contaId", "id");

ALTER TABLE "MatriculaBillingOutbox"
  DROP CONSTRAINT IF EXISTS "MatriculaBillingOutbox_matriculaId_fkey";
ALTER TABLE "MatriculaBillingOutbox"
  ADD CONSTRAINT "MatriculaBillingOutbox_contaId_matriculaId_fkey"
  FOREIGN KEY ("contaId", "matriculaId")
  REFERENCES "Matricula"("contaId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FamilyBillingOutbox"
  DROP CONSTRAINT IF EXISTS "FamilyBillingOutbox_matriculaFamiliarId_fkey";
ALTER TABLE "FamilyBillingOutbox"
  DROP CONSTRAINT IF EXISTS "FamilyBillingOutbox_rematriculaFamiliarId_fkey";
ALTER TABLE "FamilyBillingOutbox"
  ADD CONSTRAINT "FamilyBillingOutbox_contaId_matriculaFamiliarId_fkey"
  FOREIGN KEY ("contaId", "matriculaFamiliarId")
  REFERENCES "MatriculaFamiliar"("contaId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyBillingOutbox"
  ADD CONSTRAINT "FamilyBillingOutbox_contaId_rematriculaFamiliarId_fkey"
  FOREIGN KEY ("contaId", "rematriculaFamiliarId")
  REFERENCES "RematriculaFamiliar"("contaId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
