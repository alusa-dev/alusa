import { test, expect } from '@playwright/test';
import { resetDb } from '../utils/reset-db';
import { prisma, registerAndLogin, getContaId, createTurmaWithMatricula } from '../utils/fixtures';

test.describe('Cancelar matrícula libera vaga na turma', () => {
  test.beforeEach(async ({ page }) => {
    await resetDb();
    await registerAndLogin(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('vaga é liberada após cancelamento', async ({ page, request }) => {
    const contaId = await getContaId();
    const { turma, matricula } = await createTurmaWithMatricula({ contaId, capacidade: 1 });

    const before = await request.get(`/api/turmas?contaId=${contaId}`);
    expect(before.ok()).toBe(true);
    const beforeJson = await before.json();
    const turmaBefore = beforeJson.data.find((t: { id: string }) => t.id === turma.id);
    expect(turmaBefore?.vagasOcupadas).toBe(1);

    // cancelar matrícula diretamente (simula arquivamento)
    await prisma.matricula.update({ where: { id: matricula.id }, data: { status: 'CANCELADA' } });

    const after = await request.get(`/api/turmas?contaId=${contaId}`);
    expect(after.ok()).toBe(true);
    const afterJson = await after.json();
    const turmaAfter = afterJson.data.find((t: { id: string }) => t.id === turma.id);
    expect(turmaAfter?.vagasOcupadas).toBe(0);
  });
});
