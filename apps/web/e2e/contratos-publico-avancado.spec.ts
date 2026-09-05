import { test, expect } from '@playwright/test';

import prisma from './prisma';
import { authorizeSeededContractSignature } from './utils/authorize-signature';
import { resetDb } from './utils/reset-db';
import { seedContratoPublico } from './utils/seed-contratos';

test.describe('Contrato público (avançado)', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('assinatura concorrente: só 1 request deve vencer', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const authorization = await authorizeSeededContractSignature(prisma, seed);
    const payload = {
      nome: 'Responsável E2E',
      cpf: authorization.cpf,
      verificationToken: authorization.verificationToken,
      dataNascimento: '01/01/1990',
      aceite: true,
      assinatura: { tipo: 'TEXTO', valor: 'Responsável E2E' },
    };

    const [first, second] = await Promise.all([
      request.post(`/api/public/contrato/${seed.token}/assinar`, { data: payload }),
      request.post(`/api/public/contrato/${seed.token}/assinar`, { data: payload }),
    ]);

    expect([first.status(), second.status()].sort()).toEqual([200, 403]);
  });

  test('token mutado deve negar acesso', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const mutated = `${seed.token.slice(0, -1)}${seed.token.endsWith('a') ? 'b' : 'a'}`;
    const response = await request.get(`/api/public/contrato/${mutated}`);

    expect([400, 404]).toContain(response.status());
  });

  test('sem cookies/storage o endpoint público continua acessível', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const response = await request.get(`/api/public/contrato/${seed.token}`);
    expect(response.ok()).toBeTruthy();
  });

  test('GET público responde dentro do limite de sanidade', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const start = Date.now();
    const response = await request.get(`/api/public/contrato/${seed.token}`);

    expect(response.ok()).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  test('payload grande é rejeitado ou processado sem erro interno', async ({ request }) => {
    const seed = await seedContratoPublico(prisma);
    const response = await request.post(`/api/public/contrato/${seed.token}/assinar`, {
      data: {
        nome: 'X'.repeat(400),
        cpf: seed.responsavelCpfDigits,
        verificationToken: 'a'.repeat(43),
        aceite: true,
        assinatura: { tipo: 'TEXTO', valor: 'Responsável E2E' },
      },
    });

    expect([400, 403]).toContain(response.status());
  });
});
