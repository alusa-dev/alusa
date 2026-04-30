-- CreateTable
CREATE TABLE "Professor" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "especialidade" TEXT,
    "status" "Status" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Professor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_professor_conta" ON "Professor"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Professor_contaId_email_key" ON "Professor"("contaId", "email");

-- AddForeignKey
ALTER TABLE "Professor" ADD CONSTRAINT "Professor_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
