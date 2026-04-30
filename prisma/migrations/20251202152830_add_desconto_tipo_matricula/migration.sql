-- DropIndex
DROP INDEX "idx_lancamento_conta_centro";

-- AlterTable
ALTER TABLE "CategoriaLancamento" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CentroCusto" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Lancamento" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "descontoTipo" TEXT DEFAULT 'PERCENTAGE';

-- RenameIndex
ALTER INDEX "uq_categoria_lancamento_nome_tipo_parent" RENAME TO "CategoriaLancamento_contaId_nome_tipo_parentId_key";

-- RenameIndex
ALTER INDEX "uq_centrocusto_nome_tipo_conta" RENAME TO "CentroCusto_contaId_nome_tipo_key";
