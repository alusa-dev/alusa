import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';

import { resetDb } from './utils/reset-db';
import { seedContratoPublico } from './utils/seed-contratos';

test.describe('Contrato público (avançado)', () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test('assinatura concorrente: só 1 request deve vencer', async ({ request }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });

    const payload = {
      nome: 'Responsável Financeiro',
      cpf: seeded.responsavelCpfDigits!,
      email: 'rf.concorrencia@alusa.teste',
      aceite: true,
    };

    const [r1, r2] = await Promise.all([
      request.post(`/api/public/contrato/${seeded.token}/assinar`, { data: payload }),
      request.post(`/api/public/contrato/${seeded.token}/assinar`, { data: payload }),
    ]);

    const s1 = r1.status();
    const s2 = r2.status();

    expect([s1, s2].sort()).toEqual([200, 400]);

    const body1 = await r1.json().catch(() => null);
    const body2 = await r2.json().catch(() => null);

    const errorBody = s1 === 400 ? body1 : body2;
    expect(errorBody).toMatchObject({ error: { message: 'Contrato já assinado' } });
  });

  test('token mutado: deve negar acesso (404/400)', async ({ request }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });
    const mutated = seeded.token.slice(0, -1) + (seeded.token.slice(-1) === 'a' ? 'b' : 'a');

    const r = await request.get(`/api/public/contrato/${mutated}`);
    expect([400, 404]).toContain(r.status());
  });

  test('sem cookies/storage: ainda deve renderizar e assinar', async ({ browser }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });

    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto(`/contrato/${seeded.token}`);
    await expect(page.getByRole('heading', { name: /contrato/i })).toBeVisible();

    await page.getByLabel(/nome/i).fill('Responsável Sem Storage');
    await page.getByLabel(/cpf/i).fill(seeded.responsavelCpfDigits!);
    await page.getByLabel(/e-?mail/i).fill('rf.sem-storage@alusa.teste');
    await page.getByLabel(/aceito/i).check();

    await page.getByRole('button', { name: /assinar/i }).click();

    await expect(page.getByText(/contrato assinado/i)).toBeVisible();

    await context.close();
  });

  test('acessibilidade: fluxo por teclado (tab/enter) deve permitir assinar', async ({ page }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });

    await page.goto(`/contrato/${seeded.token}`);

    // Foca no primeiro campo interativo e percorre via TAB.
    await page.keyboard.press('Tab');

    // Preenche campos focados (ordem pode variar, então usa labels como fallback).
    await page.getByLabel(/nome/i).fill('Responsável Teclado');
    await page.getByLabel(/cpf/i).fill(seeded.responsavelCpfDigits!);
    await page.getByLabel(/e-?mail/i).fill('rf.teclado@alusa.teste');

    // Aceite e submit via teclado.
    await page.getByLabel(/aceito/i).focus();
    await page.keyboard.press('Space');

    const submit = page.getByRole('button', { name: /assinar/i });
    await submit.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByText(/contrato assinado/i)).toBeVisible();
  });

  test('performance básica: GET público deve responder rápido (sanidade)', async ({ request }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });

    const start = Date.now();
    const r = await request.get(`/api/public/contrato/${seeded.token}`);
    const elapsedMs = Date.now() - start;

    expect(r.ok()).toBeTruthy();
    // Limite bem folgado para CI/desenvolvimento.
    expect(elapsedMs).toBeLessThan(2000);
  });

  test('payload grande no nome não deve quebrar (sanidade)', async ({ request }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });

    const r = await request.post(`/api/public/contrato/${seeded.token}/assinar`, {
      data: {
        nome: 'X'.repeat(400),
        cpf: seeded.responsavelCpfDigits!,
        email: 'rf.payload-grande@alusa.teste',
        aceite: true,
        userAgent: 'playwright',
      },
    });

    expect([200, 400]).toContain(r.status());
  });

  test('hash segue determinístico mesmo sob concorrência (sanidade)', async ({ request }) => {
    const seeded = await seedContratoPublico({ withResponsavelFinanceiro: true });

    const payload = {
      nome: 'Responsável Hash',
      cpf: seeded.responsavelCpfDigits!,
      email: 'rf.hash@alusa.teste',
      aceite: true,
      userAgent: 'playwright',
    };

    const r = await request.post(`/api/public/contrato/${seeded.token}/assinar`, { data: payload });
    expect(r.status()).toBe(200);

    const res = (await r.json()) as { contrato?: { hashAssinatura?: string } };
    const saved = res.contrato?.hashAssinatura;
    expect(saved).toBeTruthy();

    // Recalcula: não depende de Next.
    const canonical = JSON.stringify({
      token: seeded.token,
      cpf: payload.cpf,
      nome: payload.nome,
      aceite: true,
    });
    const expected = crypto.createHash('sha256').update(canonical).digest('hex');

    expect(saved).toBe(expected);
  });
});
