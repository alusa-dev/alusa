-- DropForeignKey
ALTER TABLE "Aluno" DROP CONSTRAINT "Aluno_contaId_fkey";

-- DropForeignKey
ALTER TABLE "CategoriaLancamento" DROP CONSTRAINT "CategoriaLancamento_contaId_fkey";

-- DropForeignKey
ALTER TABLE "CentroCusto" DROP CONSTRAINT "CentroCusto_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Colaborador" DROP CONSTRAINT "Colaborador_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Combo" DROP CONSTRAINT "Combo_contaId_fkey";

-- DropForeignKey
ALTER TABLE "ContratoTemplate" DROP CONSTRAINT "ContratoTemplate_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Desconto" DROP CONSTRAINT "Desconto_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Invite" DROP CONSTRAINT "Invite_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Lancamento" DROP CONSTRAINT "Lancamento_contaId_fkey";

-- DropForeignKey
ALTER TABLE "LogFinanceiro" DROP CONSTRAINT "LogFinanceiro_contaId_fkey";

-- DropForeignKey
ALTER TABLE "LogIntegracao" DROP CONSTRAINT "LogIntegracao_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Modalidade" DROP CONSTRAINT "Modalidade_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Plano" DROP CONSTRAINT "Plano_contaId_fkey";

-- DropForeignKey
ALTER TABLE "PortalEvento" DROP CONSTRAINT "PortalEvento_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Professor" DROP CONSTRAINT "Professor_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Sala" DROP CONSTRAINT "Sala_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Turma" DROP CONSTRAINT "Turma_contaId_fkey";

-- DropForeignKey
ALTER TABLE "Usuario" DROP CONSTRAINT "Usuario_contaId_fkey";

-- DropForeignKey
ALTER TABLE "WebhookAsaas" DROP CONSTRAINT "WebhookAsaas_contaId_fkey";

-- AddForeignKey
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Professor" ADD CONSTRAINT "Professor_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aluno" ADD CONSTRAINT "Aluno_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turma" ADD CONSTRAINT "Turma_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modalidade" ADD CONSTRAINT "Modalidade_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plano" ADD CONSTRAINT "Plano_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desconto" ADD CONSTRAINT "Desconto_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAsaas" ADD CONSTRAINT "WebhookAsaas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogFinanceiro" ADD CONSTRAINT "LogFinanceiro_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogIntegracao" ADD CONSTRAINT "LogIntegracao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lancamento" ADD CONSTRAINT "Lancamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentroCusto" ADD CONSTRAINT "CentroCusto_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaLancamento" ADD CONSTRAINT "CategoriaLancamento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalEvento" ADD CONSTRAINT "PortalEvento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContratoTemplate" ADD CONSTRAINT "ContratoTemplate_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
