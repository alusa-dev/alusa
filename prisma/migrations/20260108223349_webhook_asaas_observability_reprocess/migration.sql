-- AlterTable
ALTER TABLE "WebhookAsaas" ADD COLUMN     "attemptsLog" JSONB,
ADD COLUMN     "duracaoMs" INTEGER,
ADD COLUMN     "tentativas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimaTentativaEm" TIMESTAMP(3),
ADD COLUMN     "ultimoErro" TEXT;
