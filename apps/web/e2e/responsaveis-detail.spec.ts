import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';

const prisma = new PrismaClient();

type SeedIds = {
  contaId: string;
  userId: string;
  userEmail: string;
  responsavelFluxoAlunoId: string;
  vinculoFluxoAlunoId: string;
  responsavelFluxoAlunoNome: string;
};

function uniqueDigits(length: number) {
  return String(Date.now() + Math.floor(Math.random() * 1000))
    .slice(-length)
    .padStart(length, '0');
}

function cpfCheckDigit(base: number[]) {
  const weightStart = base.length + 1;
  const sum = base.reduce((total, digit, index) => total + digit * (weightStart - index), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function uniqueCpf() {
  const baseNumber = String(Date.now() + Math.floor(Math.random() * 1_000_000))
    .slice(-9)
    .padStart(9, '0');
  const base = baseNumber.split('').map(Number);
  const firstDigit = cpfCheckDigit(base);
  const secondDigit = cpfCheckDigit([...base, firstDigit]);
  return `${baseNumber}${firstDigit}${secondDigit}`;
}

async function seed(): Promise<SeedIds> {
  const contaId = randomUUID();
  const userId = randomUUID();
  const userEmail = `admin-responsaveis-${Date.now()}@e2e.test`;
  const responsavelFluxoAlunoNome = `Resp Fluxo Aluno ${Date.now()}`;

  await prisma.conta.create({
    data: { id: contaId, nome: 'E2E Responsaveis', cpfCnpj: uniqueDigits(14) },
  });

  await prisma.usuario.create({
    data: {
      id: userId,
      contaId,
      nome: 'Admin Responsaveis',
      email: userEmail,
      senhaHash: 'hash',
      role: 'ADMIN',
      status: 'ATIVO',
    },
  });

  await prisma.conta.update({ where: { id: contaId }, data: { ownerUserId: userId } });

  const aluno = await prisma.aluno.create({
    data: {
      contaId,
      nome: `Aluno com Responsavel ${Date.now()}`,
      cpf: uniqueCpf(),
      email: `aluno-resp-${Date.now()}@e2e.test`,
      dataNasc: new Date('2012-05-10T00:00:00.000Z'),
      telefone: '11999999999',
      status: 'ATIVO',
    },
  });

  const responsavel = await prisma.responsavel.create({
    data: {
      contaId,
      nome: responsavelFluxoAlunoNome,
      cpf: uniqueCpf(),
      email: `resp-fluxo-aluno-${Date.now()}@e2e.test`,
      telefone: '11988887777',
      financeiro: true,
    },
  });

  const vinculo = await prisma.alunoResponsavel.create({
    data: {
      alunoId: aluno.id,
      responsavelId: responsavel.id,
      tipoVinculo: 'PRINCIPAL',
    },
  });

  return {
    contaId,
    userId,
    userEmail,
    responsavelFluxoAlunoId: responsavel.id,
    vinculoFluxoAlunoId: vinculo.id,
    responsavelFluxoAlunoNome,
  };
}

async function authenticate(page: Page, ids: SeedIds) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET ausente');

  const token = await encode({
    secret,
    token: {
      id: ids.userId,
      email: ids.userEmail,
      name: 'Admin Responsaveis',
      role: 'ADMIN',
      contaId: ids.contaId,
    },
  });

  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

async function cleanup(contaId: string) {
  await prisma.alunoResponsavel.deleteMany({ where: { aluno: { contaId } } });
  await prisma.aluno.deleteMany({ where: { contaId } });
  await prisma.responsavel.deleteMany({ where: { contaId } });
  await prisma.usuario.deleteMany({ where: { contaId } });
  await prisma.conta.deleteMany({ where: { id: contaId } });
}

test.describe('Detalhe de responsáveis', () => {
  let ids: SeedIds;

  test.beforeEach(async ({ page }) => {
    ids = await seed();
    await authenticate(page, ids);
  });

  test.afterEach(async () => {
    await cleanup(ids.contaId);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('abre detalhes de responsável do fluxo de aluno e de responsável criado pelo modal', async ({
    page,
  }) => {
    await page.goto('/responsaveis');

    await expect(page.getByText(ids.responsavelFluxoAlunoNome)).toBeVisible();
    await page.getByText(ids.responsavelFluxoAlunoNome).click();

    await expect(page).toHaveURL(new RegExp(`/responsaveis/${ids.responsavelFluxoAlunoId}$`));
    await expect(page.getByRole('heading', { name: 'Detalhes do responsável' })).toBeVisible();
    await expect(page.getByLabel('Nome Completo')).toHaveValue(ids.responsavelFluxoAlunoNome);
    await expect(page.getByText('Responsável não encontrado.')).toHaveCount(0);

    await page.goto(`/responsaveis/${ids.vinculoFluxoAlunoId}`);
    await expect(page.getByRole('heading', { name: 'Detalhes do responsável' })).toBeVisible();
    await expect(page.getByLabel('Nome Completo')).toHaveValue(ids.responsavelFluxoAlunoNome);
    await expect(page.getByText('Responsável não encontrado.')).toHaveCount(0);

    await page.goto('/responsaveis');
    await page.getByRole('button', { name: 'Novo responsável' }).click();

    const dialog = page.getByRole('dialog', { name: 'Novo responsável' });
    const modalResponsavelNome = `Resp Modal ${Date.now()}`;
    await dialog.getByLabel('Nome completo').fill(modalResponsavelNome);
    await dialog.getByLabel('CPF').fill(uniqueCpf());
    await dialog.getByLabel('Telefone').fill('11977776666');
    await dialog.getByLabel('E-mail').fill(`resp-modal-${Date.now()}@e2e.test`);
    await dialog.getByRole('button', { name: 'Salvar responsável' }).click();

    await expect(page.getByRole('heading', { name: 'Detalhes do responsável' })).toBeVisible();
    await expect(page.getByLabel('Nome Completo')).toHaveValue(modalResponsavelNome);
    await expect(page.getByText('Responsável não encontrado.')).toHaveCount(0);
  });
});
