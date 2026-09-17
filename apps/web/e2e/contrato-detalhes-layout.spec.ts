import { test, expect } from '@playwright/test';
import prisma from './prisma';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from './utils/auth';

test.describe('Contrato detalhes (layout)', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('viewer ocupa a altura prevista e exibe o documento', async ({ page }) => {
    test.setTimeout(90_000);

    const { contaId } = await seedAdminAndAuthenticate(page, {
      email: `contrato-layout-${Date.now()}@e2e.test`,
    });

    const aluno = await prisma.aluno.create({
      data: {
        contaId,
        nome: 'Aluno Layout',
        cpf: '12345678901',
        dataNasc: new Date('2000-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });

    const modelo = await prisma.contratoModelo.create({
      data: {
        contaId,
        nome: 'Modelo Layout',
        arquivoPdfUrl: 'https://example.com/template.pdf',
        hashSha256: `hash-${Date.now()}`,
        versao: 1,
        status: 'ATIVO',
      },
      select: { id: true },
    });

    const matricula = await prisma.matricula.create({
      data: {
        contaId,
        alunoId: aluno.id,
        dataInicio: new Date('2025-01-01T00:00:00.000Z'),
        dataFimContrato: new Date('2026-01-01T00:00:00.000Z'),
        taxaMatricula: 0,
        taxaIsenta: true,
        vencimentoDia: 5,
        statusContrato: 'AGUARDANDO_ASSINATURA',
      },
      select: { id: true },
    });

    const contrato = await prisma.contrato.create({
      data: {
        contaId,
        matriculaId: matricula.id,
        modeloId: modelo.id,
        arquivoPdfUrl: 'https://example.com/contrato.pdf',
        hashPdf: `hash-contrato-${Date.now()}`,
        status: 'PENDENTE',
        tokenPublico: `token-layout-${Date.now()}`,
        tokenExpiraEm: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    await expect
      .poll(
        async () => {
          const resp = await page.request.get(`/api/contratos/${contrato.id}`);
          return resp.status();
        },
        { timeout: 10_000 },
      )
      .toBe(200);

    await page.goto(`/contratos/${contrato.id}`);
    await expect(page.getByRole('heading', { name: /detalhes do contrato/i })).toBeVisible();

    const viewer = page.getByTitle('Contrato - Aluno Layout');
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute('style', /height:\s*82vh/);

    const viewerHeight = await viewer.evaluate((element) => element.getBoundingClientRect().height);
    expect(viewerHeight).toBeGreaterThan(0);
  });
});
