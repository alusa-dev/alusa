-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "descontoAntecipado" DECIMAL(5,2),
ADD COLUMN     "diasTolerancia" INTEGER DEFAULT 0,
ADD COLUMN     "jurosMensal" DECIMAL(5,2),
ADD COLUMN     "multaPercentual" DECIMAL(5,2),
ADD COLUMN     "prazoDesconto" INTEGER DEFAULT 0;
