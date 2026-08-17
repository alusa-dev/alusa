import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { prisma } from '../utils/fixtures';

async function registerAndLoginForLifecycle(page: Page) {
  await page.goto('/auth/register');
  await expect(page.getByTestId('register-form')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('register-nome-first').fill('Admin');
  await page.getByTestId('register-nome-last').fill(`E2E ${randomUUID().slice(0, 8)}`);
  await page.getByTestId('register-email').fill(`aluno-lifecycle-${randomUUID()}@example.com`);
  await page.getByTestId('register-senha').fill('SenhaFort3!');
  await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');
  await page.getByTestId('register-termos-checkbox').click();
  await page.getByTestId('legal-acceptance-inner-checkbox').click();
  await page.getByTestId('legal-acceptance-confirm').click();
  await expect(page.getByTestId('register-termos-checkbox')).toHaveAttribute('data-state', 'checked');
  await page.getByTestId('register-submit').click();
  await expect.poll(async () => {
    const response = await page.request.get('/api/auth/session');
    if (!response.ok()) return null;
    const session = (await response.json()) as { user?: { contaId?: string } };
    return session.user?.contaId ?? null;
  }, { timeout: 15000 }).not.toBeNull();
}

async function getContaId(page: Page) {
  const response = await page.request.get('/api/auth/session');
  const session = (await response.json()) as { user?: { contaId?: string } };
  if (!session.user?.contaId) throw new Error('Sessão sem contaId');
  return session.user.contaId;
}

function cpfFromSeed(seed: number) {
  const base = String(seed).padStart(9, '0').slice(-9).split('').map(Number);
  const calculate = (digits: number[], factor: number) => {
    const sum = digits.reduce((total, digit) => total + digit * factor--, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(base, 10);
  const second = calculate([...base, first], 11);
  return [...base, first, second].join('');
}

function adultPayload(seed: number) {
  const suffix = randomUUID().slice(0, 8);
  return {
    nome: `E2E Adulto ${suffix}`,
    cpf: cpfFromSeed(seed),
    email: `e2e-adulto-${suffix}@example.com`,
    telefone: '11999999999',
    dataNasc: '2000-01-01',
  };
}

function minorPayload(seed: number) {
  const suffix = randomUUID().slice(0, 8);
  return {
    nome: `E2E Menor ${suffix}`,
    dataNasc: '2015-05-15',
    responsavel: {
      nome: `E2E Responsável ${suffix}`,
      cpf: cpfFromSeed(seed),
      email: `e2e-responsavel-${suffix}@example.com`,
      telefone: '11999999999',
      financeiro: true,
      enderecoCep: '01001000',
      enderecoLogradouro: 'Rua E2E',
      enderecoNumero: '10',
      enderecoBairro: 'Centro',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'SP',
    },
  };
}

test.describe('ciclo de vida de aluno e responsável', () => {
  test.afterEach(async () => {
    // Os testes usam identificadores únicos; a limpeza remove somente seus
    // vínculos e registros, sem depender de DELETE em cascata do responsável.
    const testAlunos = await prisma.aluno.findMany({
      where: { nome: { startsWith: 'E2E ' } },
      select: { id: true },
    });
    const alunoIds = testAlunos.map((aluno) => aluno.id);
    if (alunoIds.length > 0) {
      await prisma.matricula.deleteMany({ where: { alunoId: { in: alunoIds } } });
      await prisma.alunoResponsavel.deleteMany({ where: { alunoId: { in: alunoIds } } });
      await prisma.customer.deleteMany({ where: { payerType: 'ALUNO', payerId: { in: alunoIds } } });
      await prisma.aluno.deleteMany({ where: { id: { in: alunoIds } } });
    }
    await prisma.responsavel.deleteMany({ where: { nome: { startsWith: 'E2E Responsável ' } } });
  });

  test('recadastra maior de idade inativo usando o mesmo aluno', async ({ page }) => {
    await registerAndLoginForLifecycle(page);
    const payload = adultPayload(Date.now() % 900000000);
    const firstResponse = await page.request.post('/api/alunos', { data: payload });
    expect(firstResponse.status()).toBe(201);
    const first = await firstResponse.json() as { id: string };
    const contaId = await getContaId(page);
    await prisma.aluno.update({
      where: { id: first.id },
      data: { status: 'INATIVO', motivoInativacao: 'Teste E2E', dataInativacao: new Date() },
    });

    const secondResponse = await page.request.post('/api/alunos', {
      data: { ...payload, nome: `${payload.nome} Atualizado` },
    });
    expect(secondResponse.status()).toBe(201);
    const second = await secondResponse.json() as { id: string };

    expect(second.id).toBe(first.id);
    await expect.poll(async () =>
      prisma.aluno.count({ where: { contaId, cpf: payload.cpf } }),
    ).toBe(1);
    await expect.poll(async () =>
      prisma.aluno.findUnique({ where: { id: first.id }, select: { status: true } }),
    ).toEqual({ status: 'ATIVO' });
  });

  test('recadastra menor sem CPF, reutiliza responsável e não duplica vínculo', async ({ page }) => {
    await registerAndLoginForLifecycle(page);
    const payload = minorPayload((Date.now() + 1) % 900000000);
    const firstResponse = await page.request.post('/api/alunos', { data: payload });
    expect(firstResponse.status()).toBe(201);
    const first = await firstResponse.json() as { id: string };
    const contaId = await getContaId(page);
    const responsavel = await prisma.responsavel.findFirst({
      where: { contaId, cpf: payload.responsavel.cpf },
      select: { id: true },
    });
    expect(responsavel).not.toBeNull();

    await prisma.aluno.update({
      where: { id: first.id },
      data: { status: 'INATIVO', motivoInativacao: 'Teste E2E', dataInativacao: new Date() },
    });

    const secondResponse = await page.request.post('/api/alunos', {
      data: { ...payload, nome: payload.nome },
    });
    expect(secondResponse.status()).toBe(201);
    const second = await secondResponse.json() as { id: string };

    expect(second.id).toBe(first.id);
    expect(
      await prisma.responsavel.count({ where: { contaId, cpf: payload.responsavel.cpf } }),
    ).toBe(1);
    expect(
      await prisma.alunoResponsavel.count({
        where: { contaId, alunoId: first.id, responsavelId: responsavel!.id },
      }),
    ).toBe(1);
  });

  test('bloqueia exclusão de responsável com aluno ativo', async ({ page }) => {
    await registerAndLoginForLifecycle(page);
    const payload = minorPayload((Date.now() + 2) % 900000000);
    const alunoResponse = await page.request.post('/api/alunos', { data: payload });
    expect(alunoResponse.status()).toBe(201);
    const aluno = await alunoResponse.json() as { id: string };

    const contaId = await getContaId(page);
    const responsavel = await prisma.responsavel.findFirst({
      where: { contaId, cpf: payload.responsavel.cpf },
      select: { id: true },
    });
    expect(responsavel).not.toBeNull();

    const response = await page.request.delete(`/api/responsaveis/${responsavel.id}`);
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('EXCLUSAO_RESPONSAVEL_CONFLITO');
    expect(body.conflitos).toContain('existem alunos ativos vinculados a este responsável');
    expect(
      await prisma.aluno.findUnique({ where: { id: aluno.id }, select: { status: true } }),
    ).toEqual({ status: 'ATIVO' });
  });

  test('remove definitivamente aluno sem histórico e mantém operação idempotente', async ({ page }) => {
    await registerAndLoginForLifecycle(page);
    const payload = adultPayload((Date.now() + 3) % 900000000);
    const createResponse = await page.request.post('/api/alunos', { data: payload });
    expect(createResponse.status()).toBe(201);
    const aluno = await createResponse.json() as { id: string };

    const deleteResponse = await page.request.delete(`/api/alunos/${aluno.id}`, {
      headers: { 'x-correlation-id': 'e2e-hard-delete' },
    });
    expect(deleteResponse.status()).toBe(200);
    const deleted = await deleteResponse.json() as {
      deletion: { outcome: string };
    };
    expect(deleted.deletion.outcome).toBe('HARD_DELETED');
    expect(await prisma.aluno.findUnique({ where: { id: aluno.id } })).toBeNull();

    const repeatedDelete = await page.request.delete(`/api/alunos/${aluno.id}`);
    expect(repeatedDelete.status()).toBe(404);
  });

  test('bloqueia arquivamento com matrícula pendente e preserva o vínculo', async ({ page }) => {
    await registerAndLoginForLifecycle(page);
    const payload = adultPayload((Date.now() + 4) % 900000000);
    const createResponse = await page.request.post('/api/alunos', { data: payload });
    expect(createResponse.status()).toBe(201);
    const aluno = await createResponse.json() as { id: string };
    const contaId = await getContaId(page);

    const matricula = await prisma.matricula.create({
      data: {
        contaId,
        alunoId: aluno.id,
        dataInicio: new Date('2026-01-01'),
        dataFimContrato: new Date('2026-12-31'),
        taxaMatricula: 0,
        status: 'ATIVA',
      },
      select: { id: true },
    });

    const deleteResponse = await page.request.delete(`/api/alunos/${aluno.id}`);
    expect(deleteResponse.status()).toBe(409);
    const blocked = await deleteResponse.json() as { code: string };
    expect(blocked.code).toBe('ALUNO_HAS_MATRICULAS');
    expect(await prisma.aluno.findUnique({ where: { id: aluno.id }, select: { status: true } }))
      .toEqual({ status: 'ATIVO' });
    expect(await prisma.matricula.findUnique({ where: { id: matricula.id }, select: { status: true } }))
      .toEqual({ status: 'ATIVA' });
  });
});
