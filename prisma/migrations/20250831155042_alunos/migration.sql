-- CreateTable
CREATE TABLE "Aluno" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "dataNasc" TIMESTAMP(3) NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" TEXT,
    "observacao" TEXT,
    "status" "Status" NOT NULL DEFAULT 'ATIVO',
    "asaasId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Aluno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Responsavel" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "endereco" TEXT,
    "financeiro" BOOLEAN NOT NULL DEFAULT false,
    "asaasId" TEXT,

    CONSTRAINT "Responsavel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlunoResponsavel" (
    "id" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "responsavelId" TEXT NOT NULL,
    "tipoVinculo" TEXT NOT NULL,

    CONSTRAINT "AlunoResponsavel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_email_key" ON "Aluno"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_asaasId_key" ON "Aluno"("asaasId");

-- CreateIndex
CREATE INDEX "Aluno_contaId_idx" ON "Aluno"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Responsavel_email_key" ON "Responsavel"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Responsavel_asaasId_key" ON "Responsavel"("asaasId");

-- CreateIndex
CREATE INDEX "AlunoResponsavel_alunoId_idx" ON "AlunoResponsavel"("alunoId");

-- CreateIndex
CREATE INDEX "AlunoResponsavel_responsavelId_idx" ON "AlunoResponsavel"("responsavelId");

-- AddForeignKey
ALTER TABLE "Aluno" ADD CONSTRAINT "Aluno_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlunoResponsavel" ADD CONSTRAINT "AlunoResponsavel_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlunoResponsavel" ADD CONSTRAINT "AlunoResponsavel_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
