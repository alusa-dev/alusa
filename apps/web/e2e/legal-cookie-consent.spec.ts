import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

test.describe('LGPD public flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
  });

  test('cadastro exige aceite interno no modal legal', async ({ page }) => {
    await resetDb(prisma);

    await page.goto('/register');
    await page.getByTestId('register-nome-first').fill('Ana');
    await page.getByTestId('register-nome-last').fill('Gestora');
    await page.getByTestId('register-email').fill('ana.gestora@example.com');
    await page.getByTestId('register-senha').fill('SenhaFort3!');
    await page.getByTestId('register-senha-confirmar').fill('SenhaFort3!');

    await expect(page.getByTestId('register-submit')).toBeDisabled();
    await page.getByTestId('register-termos-checkbox').click();
    await expect(page.getByRole('dialog', { name: /Termos, privacidade e tratamento de dados/i })).toBeVisible();
    await expect(page.getByTestId('register-submit')).toBeDisabled();

    await page.getByRole('button', { name: /Fechar/i }).click();
    await expect(page.getByTestId('register-termos-checkbox')).toHaveAttribute('data-state', 'unchecked');

    await page.getByTestId('register-termos-checkbox').click();
    await expect(page.getByRole('button', { name: /Aceitar e continuar/i })).toBeDisabled();
    await page.getByTestId('legal-acceptance-inner-checkbox').click();
    await page.getByRole('button', { name: /Aceitar e continuar/i }).click();

    await expect(page.getByTestId('register-termos-checkbox')).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('register-submit')).toBeEnabled();
  });

  test('banner de cookies permite rejeitar nao necessarios e salva preferencias', async ({ page }) => {
    await page.goto('/privacidade');

    await expect(page.getByRole('region', { name: /Preferencias de cookies/i })).toBeVisible();
    await page.getByRole('button', { name: /Preferencias/i }).click();
    await expect(page.getByRole('dialog', { name: /Preferencias de cookies/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Cookies de analise/i })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Cookies de marketing/i })).not.toBeChecked();

    await page.getByRole('button', { name: /Rejeitar nao necessarios/i }).click();
    await expect(page.getByRole('region', { name: /Preferencias de cookies/i })).toBeHidden();

    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('alusa.cookie-consent.v1') ?? '{}'));
    expect(stored.categories).toMatchObject({
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
  });
});
