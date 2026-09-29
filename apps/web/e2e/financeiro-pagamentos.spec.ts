import { test, expect } from '@playwright/test';
import { seedAdminAndAuthenticate } from './utils/auth';
import { randomUUID } from 'node:crypto';

// E2E básico: login e navegação até /finance/payments

test.describe('Financeiro - Pagamentos', () => {
  test('lista de pagamentos renderiza elementos principais', async ({ page }) => {
    await seedAdminAndAuthenticate(page, { email: `finance-pagamentos-${randomUUID()}@e2e.test` });
    await page.goto('/finance/payments');
    await expect(page.getByRole('heading', { name: 'Pagamentos' })).toBeVisible();
    await expect(page.getByPlaceholder('Buscar por nome...')).toBeVisible();
    await expect(page.getByText('Nenhuma pessoa com histórico financeiro encontrada')).toBeVisible();
  });
});
