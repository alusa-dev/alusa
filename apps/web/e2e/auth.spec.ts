import { test, expect } from '@playwright/test';

test('registro inicial e login admin', async ({ page }) => {
  await page.goto('/register');
  await page.fill('[data-testid="register-escolaNome"]', 'Escola X');
  await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
  await page.fill('[data-testid="register-nome"]', 'Admin');
  await page.fill('[data-testid="register-email"]', 'admin@example.com');
  await page.fill('[data-testid="register-senha"]', 'senha123');
  await page.click('[data-testid="register-submit"]');
  await page.waitForURL('**/dashboard');
  await expect(page.locator('[data-testid="dashboard"]')).toContainText('Admin');
  await expect(page.locator('[data-testid="dashboard"]')).toContainText('ADMIN');
});