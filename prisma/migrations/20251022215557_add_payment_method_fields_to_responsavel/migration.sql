-- DropIndex
DROP INDEX "Invite_contaId_email_status_key";

-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "enderecoBairro" TEXT,
ADD COLUMN     "enderecoCep" CHAR(8),
ADD COLUMN     "enderecoCidade" TEXT,
ADD COLUMN     "enderecoLogradouro" TEXT,
ADD COLUMN     "enderecoNumero" TEXT,
ADD COLUMN     "enderecoUf" CHAR(2);

-- AlterTable
ALTER TABLE "Responsavel" ADD COLUMN     "creditCardBrand" TEXT,
ADD COLUMN     "creditCardExpiryMonth" INTEGER,
ADD COLUMN     "creditCardExpiryYear" INTEGER,
ADD COLUMN     "creditCardLast4" TEXT,
ADD COLUMN     "creditCardUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "preferredBillingType" TEXT;
