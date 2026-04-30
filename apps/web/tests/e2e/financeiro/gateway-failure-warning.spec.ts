import { test, expect } from '@playwright/test';
import { resetDb } from '../utils/reset-db';
import { prisma, registerAndLogin, getContaId, createAlunoWithMatriculaAndSubscription } from '../utils/fixtures';

test.describe('Falha no gateway ao cancelar assinatura', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await registerAndLogin(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('exibe warning e mantém estado consistente', async ({ page }) => {
    const contaId = await getContaId();

    const { alunoId, alunoNome, matriculaId } = await createAlunoWithMatriculaAndSubscription({
      contaId,
      alunoNome: 'Aluno Gateway Falha',
      asaasSubscriptionId: 'fail-sub-001',
    });

    await page.goto(`/test/alunos/archive?alunoId=${alunoId}`);
    await page.getByTestId('test-aluno-nome-input').fill(alunoNome);
    await page.getByTestId('test-open-archive-dialog').click();
    await page.getByRole('button', { name: /^Arquivar$/ }).click();

    await expect(page.getByText('Aluno arquivado')).toBeVisible();
    await expect(
      page.getByText('Algumas cobranças podem não ter sido canceladas no processador. Verifique manualmente.')
    ).toBeVisible();

    const aluno = await prisma.aluno.findUnique({ where: { id: alunoId }, select: { status: true } });
    const matricula = await prisma.matricula.findUnique({ where: { id: matriculaId }, select: { status: true } });

    expect(aluno?.status).toBe('INATIVO');
    expect(matricula?.status).toBe('CANCELADA');
  });
});
