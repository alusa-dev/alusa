import { test, expect } from '@playwright/test';
import { resetDb } from './utils/reset-db';
import { seedAdminAndAuthenticate } from '../../e2e/utils/auth';
import { randomUUID } from 'node:crypto';

test.describe('Configurações - Integrações (Asaas)', () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test('mantém o gerenciamento de conta externa protegido no modo whitelabel', async ({ page }) => {
    await seedAdminAndAuthenticate(page, { email: `admin-int-${randomUUID()}@e2e.test` });
    await page.goto('/admin/configuracoes/integracoes/asaas');
    await expect(page).toHaveURL(/\/admin\/configuracoes\/integracoes$/);
    await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  });
});
