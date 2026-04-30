/*
  Warnings:

  - Changed the type of `payerType` on the `RematriculaOperacao` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "RematriculaOperacao" DROP COLUMN "payerType",
ADD COLUMN     "payerType" "CustomerPayerType" NOT NULL;

-- DropEnum
DROP TYPE "PayerType";
