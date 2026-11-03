-- Usuario identity must survive Conta deletion. Authorization and operational
-- ownership are tenant memberships; this column remains only as legacy default.
ALTER TABLE "Usuario"
  ALTER COLUMN "contaId" DROP NOT NULL;

ALTER TABLE "Usuario"
  DROP CONSTRAINT IF EXISTS "Usuario_contaId_fkey";

ALTER TABLE "Usuario"
  ADD CONSTRAINT "Usuario_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Expand first: establish the tenant-scoped uniqueness before removing the
-- previous global one-to-one constraint. Existing collaborator rows are kept.
CREATE UNIQUE INDEX IF NOT EXISTS "Colaborador_contaId_usuarioId_key"
  ON "Colaborador"("contaId", "usuarioId");

DROP INDEX IF EXISTS "Colaborador_usuarioId_key";
