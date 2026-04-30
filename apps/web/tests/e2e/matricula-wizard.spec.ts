import { test, expect } from '@playwright/test';
import { login } from './utils/login';

test.describe('Wizard de matrícula', () => {
  test('abre página dedicada na recepção', async ({ page }) => {
    await login(page);
    await page.goto('/recepcao/matriculas/nova');
    await expect(page.getByRole('heading', { name: 'Nova matrícula' })).toBeVisible();
    await expect(page.getByTestId('matricula-wizard-flow')).toBeVisible();
  });
});
