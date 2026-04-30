-- AlterTable
-- Tornar email opcional e adicionar campo metadata para armazenar dados extras (alunosIds)
ALTER TABLE "Invite" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Drop constraint única que incluía email (não funciona bem com NULL)
ALTER TABLE "Invite" DROP CONSTRAINT IF EXISTS "uq_invite_conta_email_status";

-- Adicionar índices úteis
CREATE INDEX IF NOT EXISTS "idx_invite_expires" ON "Invite"("expiresAt");
CREATE INDEX IF NOT EXISTS "idx_invite_conta" ON "Invite"("contaId");




