import { test, expect } from '@playwright/test';
import prisma from '../lib/prisma';
import { resetDb } from './utils/reset-db';

test.describe('Contrato detalhes (layout)', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('viewer ocupa altura, tem scroll e paginação', async ({ page }) => {
    test.setTimeout(90_000);

    // Cria (ou garante) uma conta/usuário de teste alinhados ao fallback de auth em E2E
    const contaCpfCnpj = '00000000000000';
    const conta =
      (await prisma.conta.findFirst({
        where: { cpfCnpj: contaCpfCnpj },
        select: { id: true },
      })) ||
      (await prisma.conta.create({
        data: { nome: 'Conta Test', cpfCnpj: contaCpfCnpj },
        select: { id: true },
      }));

    await prisma.usuario.upsert({
      where: { email: 'admin-e2e@example.com' },
      update: { contaId: conta.id, role: 'ADMIN', status: 'ATIVO' },
      create: {
        contaId: conta.id,
        nome: 'Admin Test',
        email: 'admin-e2e@example.com',
        telefone: null,
        foto: null,
        bio: null,
        senhaHash: 'test',
        role: 'ADMIN',
        status: 'ATIVO',
        locale: 'pt-BR',
        theme: 'system',
      },
      select: { id: true },
    });

    const contaId = conta.id;

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
        arquivoUrl: 'https://example.com/template.pdf',
        hashPdf: `hash-${Date.now()}`,
        versao: 1,
        ativo: true,
      },
      select: { id: true },
    });

    const matricula = await prisma.matricula.create({
      data: {
        alunoId: aluno.id,
        responsavelFinanceiroId: null,
        planoId: null,
        turmaId: null,
        comboId: null,
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

    // Scroll container deve existir e ter overflow vertical
    const viewer = page.locator('.custom-scroll-area').first();
    await expect(viewer).toBeVisible();

    const hasOverflow = await viewer.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(hasOverflow).toBe(true);

    // Paginador deve aparecer para múltiplas páginas
    await expect(page.getByLabel('Próxima página')).toBeVisible();
  });
});
