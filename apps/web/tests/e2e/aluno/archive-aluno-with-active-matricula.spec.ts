import { test, expect } from '@playwright/test';
import { resetDb } from '../utils/reset-db';
import { prisma, registerAndLogin, getContaId, createAlunoWithMatriculaAndSubscription } from '../utils/fixtures';

test.describe('Arquivar aluno com matrícula ativa + assinatura ativa', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await registerAndLogin(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('arquiva aluno e cancela matrícula/assinatura', async ({ page }) => {
    const contaId = await getContaId();

    const { alunoId, alunoNome, matriculaId, subscriptionDbId } = await createAlunoWithMatriculaAndSubscription({
      contaId,
      alunoNome: 'Aluno Arquivar',
      asaasSubscriptionId: 'sub-ok-1',
    });

    await page.goto(`/test/alunos/archive?alunoId=${alunoId}`);
    await expect(page.getByTestId('test-aluno-archive-page')).toBeVisible();

    await page.getByTestId('test-open-archive-dialog').click();
    await page.getByRole('button', { name: /^Arquivar$/ }).click();

    await expect(page.getByText('Aluno arquivado')).toBeVisible();
    await expect(page.getByText('1 matrícula(s) foram canceladas automaticamente.')).toBeVisible();
    await expect(page.getByText('1 assinatura(s) foram canceladas no processador.')).toBeVisible();

    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { status: true } });
    const matricula = await prisma.matricula.findUnique({ where: { id: matriculaId }, select: { status: true } });
    const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionDbId }, select: { status: true } });
    const cobrancasCount = await prisma.cobranca.count({ where: { matriculaId } });

    expect(aluno?.status).toBe('INATIVO');
    expect(matricula?.status).toBe('CANCELADA');
    expect(subscription?.status).toBe('DELETED');
    expect(cobrancasCount).toBe(0);
  });
});
