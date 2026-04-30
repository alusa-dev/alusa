import { test, expect } from '@playwright/test';
import { resetDb } from '../utils/reset-db';
import {
  prisma,
  registerAndLogin,
  getContaId,
  createResponsavelWithTwoAlunos,
} from '../utils/fixtures';

test.describe('Arquivar aluno com responsável compartilhado', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await registerAndLogin(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('pagador permanece ativo quando compartilhado', async ({ page }) => {
    const contaId = await getContaId();
    const { alunoA, alunoB } = await createResponsavelWithTwoAlunos({ contaId });

    await page.goto(`/test/alunos/archive?alunoId=${alunoA.id}`);
    await page.getByTestId('test-aluno-nome-input').fill(alunoA.nome);
    await page.getByTestId('test-open-archive-dialog').click();
    await page.getByRole('button', { name: /^Arquivar$/ }).click();

    await expect(page.getByText('Aluno arquivado')).toBeVisible();
    await expect(page.getByText('Pagador mantido pois possui outros vínculos ativos.')).toBeVisible();

    const alunoAUpdated = await prisma.aluno.findUnique({ where: { id: alunoA.id }, select: { status: true } });
    const alunoBUpdated = await prisma.aluno.findUnique({ where: { id: alunoB.id }, select: { status: true } });

    expect(alunoAUpdated?.status).toBe('INATIVO');
    expect(alunoBUpdated?.status).toBe('ATIVO');
  });
});
