import crypto from 'node:crypto';

import { test, expect } from '@playwright/test';

import prisma from './prisma';
import { authorizeSeededContractSignature } from './utils/authorize-signature';
import { resetDb } from './utils/reset-db';
import { seedContratoPublico } from './utils/seed-contratos';

function signaturePayload(input: {
  cpf: string;
  verificationToken: string;
  nome?: string;
  dataNascimento?: string;
}) {
  const nome = input.nome ?? 'Responsável E2E';
  return {
    nome,
    cpf: input.cpf,
    verificationToken: input.verificationToken,
    dataNascimento: input.dataNascimento ?? '01/01/1990',
    aceite: true,
    assinatura: { tipo: 'TEXTO' as const, valor: nome },
    userAgent: 'playwright',
  };
}

test.describe('Contratos (público)', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('token inválido mostra erro', async ({ page }) => {
    await page.goto('/p/contrato/token-inexistente');
    await expect(page.getByText(/não foi possível acessar/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/contrato não encontrado/i)).toBeVisible();
  });

  test('endpoint público entrega o fluxo atual sem placeholders', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const response = await request.get(`/api/public/contrato/${seed.token}`);
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).not.toMatch(/\{\{.+?\}\}/);
    expect(body).toContain('arquivoPdfUrl');
  });

  test('assina com OTP autorizado e persiste no DB', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const authorization = await authorizeSeededContractSignature(prisma, seed);

    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      data: signaturePayload({ cpf: authorization.cpf, verificationToken: authorization.verificationToken }),
    });
    expect(response.status()).toBe(200);

    const contract = await prisma.contrato.findUnique({
      where: { tokenPublico: seed.token },
      select: {
        status: true,
        assinadoCpf: true,
        matricula: { select: { statusContrato: true, contratoAtualId: true } },
      },
    });
    expect(contract?.status).toBe('ASSINADO');
    expect(contract?.assinadoCpf).toBe(seed.responsavelCpfDigits);
    expect(contract?.matricula.statusContrato).toBe('ATIVO');
    expect(contract?.matricula.contratoAtualId).toBeTruthy();
  });

  test('rejeita assinatura sem autorização OTP', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: signaturePayload({ cpf: seed.responsavelCpfDigits!, verificationToken: 'a'.repeat(43) }),
    });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { message: /confirme o código/i } });
  });

  test('exige aceite e dados válidos antes de assinar', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: {
        nome: 'Responsável E2E',
        cpf: seed.responsavelCpfDigits,
        verificationToken: 'a'.repeat(43),
        assinatura: { tipo: 'TEXTO', valor: 'Responsável E2E' },
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { message: 'Dados inválidos' } });
  });

  test('bloqueia re-assinatura quando já está ASSINADO', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const authorization = await authorizeSeededContractSignature(prisma, seed);
    const payload = signaturePayload({ cpf: authorization.cpf, verificationToken: authorization.verificationToken });

    const first = await request.post(`/api/public/contrato/${seed.token}/assinar`, { data: payload });
    expect(first.status()).toBe(200);

    const second = await request.post(`/api/public/contrato/${seed.token}/assinar`, { data: payload });
    expect(second.status()).toBe(400);
    await expect(second.json()).resolves.toMatchObject({ error: { message: 'Contrato já assinado' } });
  });

  test('aluno maior de idade assina quando não há responsável financeiro', async ({ request }) => {
    const seed = await seedContratoPublico(prisma, {
      withResponsavelFinanceiro: false,
      alunoDataNasc: new Date('2000-01-01T00:00:00.000Z'),
    });
    const authorization = await authorizeSeededContractSignature(prisma, seed, {
      cpf: seed.alunoCpfDigits,
      name: 'Aluno E2E',
      email: seed.alunoEmail,
    });
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: signaturePayload({ cpf: authorization.cpf, verificationToken: authorization.verificationToken, nome: 'Aluno E2E' }),
    });

    expect(response.status()).toBe(200);
  });

  test('aluno menor de idade não pode assinar', async ({ request }) => {
    const seed = await seedContratoPublico(prisma, {
      withResponsavelFinanceiro: false,
      alunoDataNasc: new Date('2018-01-01T00:00:00.000Z'),
    });
    const authorization = await authorizeSeededContractSignature(prisma, seed, {
      cpf: seed.alunoCpfDigits,
      name: 'Aluno E2E',
      email: seed.alunoEmail,
    });
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: signaturePayload({ cpf: authorization.cpf, verificationToken: authorization.verificationToken, nome: 'Aluno E2E' }),
    });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { message: /menor de idade/i } });
  });

  test('rejeita assinatura com CPF não autorizado', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: signaturePayload({ cpf: '93541134780', verificationToken: 'a'.repeat(43), nome: 'Pessoa Errada' }),
    });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { message: /cpf não corresponde/i } });
  });

  test('bloqueia link expirado', async ({ request }) => {
    const seed = await seedContratoPublico(prisma, { tokenExpiraEm: new Date(Date.now() - 60_000) });
    const response = await request.get(`/api/public/contrato/${seed.token}`);

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { message: 'Link expirado' } });
  });

  test('bloqueia contrato cancelado', async ({ request }) => {
    const seed = await seedContratoPublico(prisma, { status: 'CANCELADO' });
    const response = await request.get(`/api/public/contrato/${seed.token}`);

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { message: 'Este contrato foi cancelado' } });
  });

  test('hash da assinatura é determinístico e auditável', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const authorization = await authorizeSeededContractSignature(prisma, seed);
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      data: signaturePayload({ cpf: authorization.cpf, verificationToken: authorization.verificationToken }),
    });
    expect(response.status()).toBe(200);

    const contract = await prisma.contrato.findUniqueOrThrow({
      where: { tokenPublico: seed.token },
      select: { hashAssinatura: true },
    });
    expect(contract.hashAssinatura).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.createHash('sha256').update(contract.hashAssinatura!).digest('hex')).toMatch(/^[a-f0-9]{64}$/);
  });
});
