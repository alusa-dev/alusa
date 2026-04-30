-- CreateTable
CREATE TABLE "MatriculaTurma" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "turmaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatriculaTurma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_matriculaturma_matricula" ON "MatriculaTurma"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_matriculaturma_turma" ON "MatriculaTurma"("turmaId");

-- CreateIndex
CREATE UNIQUE INDEX "MatriculaTurma_matriculaId_turmaId_key" ON "MatriculaTurma"("matriculaId", "turmaId");

-- AddForeignKey
ALTER TABLE "MatriculaTurma" ADD CONSTRAINT "MatriculaTurma_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaTurma" ADD CONSTRAINT "MatriculaTurma_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
