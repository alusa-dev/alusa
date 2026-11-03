-- A collaborator profile may be linked to a user only when that identity has
-- a membership in the same school. A profile link is not an access grant.
-- Validate existing data before installing the FK so an inconsistent legacy
-- row fails the migration with an actionable error instead of being rewritten.
-- Hold write locks across the precondition and FK creation so a concurrent
-- profile write cannot slip into the gap after validation.
BEGIN;
LOCK TABLE "Colaborador", "UsuarioConta" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Colaborador" AS collaborator
    WHERE collaborator."usuarioId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "UsuarioConta" AS membership
        WHERE membership."usuarioId" = collaborator."usuarioId"
          AND membership."contaId" = collaborator."contaId"
      )
  ) THEN
    RAISE EXCEPTION 'Cannot require Colaborador membership: linked profiles exist without matching UsuarioConta (usuarioId, contaId)';
  END IF;
END $$;

ALTER TABLE "Colaborador"
  ADD CONSTRAINT "Colaborador_usuarioId_contaId_fkey"
  FOREIGN KEY ("usuarioId", "contaId")
  REFERENCES "UsuarioConta" ("usuarioId", "contaId")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "Colaborador"
  VALIDATE CONSTRAINT "Colaborador_usuarioId_contaId_fkey";

COMMIT;
