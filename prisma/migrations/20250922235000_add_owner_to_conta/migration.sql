-- Backfill ownerUserId com o primeiro ADMIN da conta (se existir)
UPDATE "Conta" c
SET "ownerUserId" = u."id"
FROM "Usuario" u
WHERE u."contaId" = c."id" AND u."role" = 'ADMIN'
AND c."ownerUserId" IS NULL
AND u."id" = (
  SELECT u2."id" FROM "Usuario" u2 WHERE u2."contaId" = c."id" AND u2."role" = 'ADMIN' ORDER BY u2."createdAt" ASC LIMIT 1
);

-- Alterar para NOT NULL
ALTER TABLE "Conta" ALTER COLUMN "ownerUserId" SET NOT NULL;

-- Index
CREATE INDEX IF NOT EXISTS "idx_conta_ownerUserId" ON "Conta"("ownerUserId");

-- Ajustar FK para RESTRICT em delete e CASCADE em update
ALTER TABLE "Conta" DROP CONSTRAINT IF EXISTS "Conta_ownerUserId_fkey";
ALTER TABLE "Conta" ADD CONSTRAINT "Conta_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
