-- AlterTable
ALTER TABLE "Cobranca" ADD COLUMN     "descontoPercentual" DECIMAL(5,2) DEFAULT 0,
ADD COLUMN     "descontoPrazoMaximo" TEXT DEFAULT 'ATE_VENCIMENTO',
ADD COLUMN     "descontoTipo" TEXT DEFAULT 'VALOR_FIXO',
ADD COLUMN     "descontoValorFixo" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "jurosPercentual" DECIMAL(5,2) DEFAULT 0,
ADD COLUMN     "jurosValorFixo" DECIMAL(12,2) DEFAULT 0,
ADD COLUMN     "multaPercentual" DECIMAL(5,2) DEFAULT 0,
ADD COLUMN     "multaTipo" TEXT DEFAULT 'VALOR_FIXO',
ADD COLUMN     "multaValorFixo" DECIMAL(12,2) DEFAULT 0;
