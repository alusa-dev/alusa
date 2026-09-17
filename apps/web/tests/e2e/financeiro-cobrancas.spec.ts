import { test, expect } from '@playwright/test';
import { seedAdminAndAuthenticate } from '../../e2e/utils/auth';
import { randomUUID } from 'node:crypto';

// E2E básico: login e navegação até /financeiro/cobrancas exibindo tabela

test.describe('Financeiro - Cobranças', () => {
  test('lista de cobranças renderiza elementos principais', async ({ page }) => {
    await seedAdminAndAuthenticate(page, { email: `finance-cobrancas-${randomUUID()}@e2e.test` });
    await page.goto('/financeiro/cobrancas');
    await expect(page.getByRole('heading', { name: 'Todas as Cobranças' })).toBeVisible();
    await expect(page.getByPlaceholder('Buscar por aluno ou descrição...')).toBeVisible();
  });
});
