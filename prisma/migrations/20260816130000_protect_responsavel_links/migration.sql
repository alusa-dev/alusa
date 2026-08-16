-- Impede que a exclusão física de um responsável remova vínculos de alunos
-- silenciosamente. A aplicação valida alunos ativos e dependências; o banco
-- preserva qualquer vínculo remanescente como última linha de defesa.
ALTER TABLE "AlunoResponsavel"
  DROP CONSTRAINT "AlunoResponsavel_responsavelId_fkey";

ALTER TABLE "AlunoResponsavel"
  ADD CONSTRAINT "AlunoResponsavel_responsavelId_fkey"
  FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
