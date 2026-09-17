import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetDb } from './utils/reset-db';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function acceptLegalTerms(page: Page) {
  await page.getByTestId('register-termos-checkbox').click();
  await page.getByTestId('legal-acceptance-inner-checkbox').click();
  await page.getByTestId('legal-acceptance-confirm').click();
}

test.describe('Fluxo de Primeiro Cadastro', () => {
  test.beforeEach(async () => { await resetDb(prisma); });

  test('Homepage pública oferece o cadastro quando não há usuários', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Teste grátis por 14 dias' }).first()).toHaveAttribute('href', '/register');
  });

  test('Login público permanece disponível quando não há usuários', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Bem-vindo de volta!' })).toBeVisible();
  });

  test('Fluxo completo: homepage → register → login', async ({ page }) => {
    // 1. Acessa a homepage pública e segue para o cadastro
    await page.goto('/');
    await page.getByRole('link', { name: 'Teste grátis por 14 dias' }).first().click();
    await page.waitForURL('**/register');
    
    // 2. Faz o primeiro cadastro
    await page.fill('[data-testid="register-nome-first"]', 'Admin');
    await page.fill('[data-testid="register-nome-last"]', 'Sistema');
    await page.fill('[data-testid="register-email"]', 'admin@sistema.com');
    await page.fill('[data-testid="register-senha"]', 'MinhaSenh@123');
    await page.fill('[data-testid="register-senha-confirmar"]', 'MinhaSenh@123');
    await acceptLegalTerms(page);
    await page.click('[data-testid="register-submit"]');
    
    // 3. O cadastro cria a conta e pede confirmação de e-mail
    await page.waitForURL('**/auth/confirm-email?callbackUrl=%2Ffinance%2Fwizard');
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
    
    // 4. Logout e acessa a homepage pública novamente
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Entrar' }).first()).toHaveAttribute('href', '/auth/login');
    
    // 5. O cadastro exige confirmação de e-mail antes do primeiro login.
    await page.getByRole('link', { name: 'Entrar' }).first().click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole('heading', { name: 'Bem-vindo de volta!' })).toBeVisible();
  });

  test('Tentativa de acesso direto ao register após ter usuários', async ({ page }) => {
    // Cria primeiro usuário
    await page.goto('/register');
    await page.fill('[data-testid="register-nome-first"]', 'Admin');
    await page.fill('[data-testid="register-nome-last"]', 'Sistema');
    await page.fill('[data-testid="register-email"]', 'admin@sistema.com');
    await page.fill('[data-testid="register-senha"]', 'MinhaSenh@123');
    await page.fill('[data-testid="register-senha-confirmar"]', 'MinhaSenh@123');
    await acceptLegalTerms(page);
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/auth/confirm-email?callbackUrl=%2Ffinance%2Fwizard');
    
    // Limpa cookies e tenta acessar register novamente
    await page.context().clearCookies();
    await page.goto('/register');
    
    await expect(page.getByRole('heading', { name: 'Crie sua conta Alusa' })).toBeVisible();
  });
});
