import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetDb } from './utils/reset-db';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function waitSession(page: Page) {
  await expect.poll(async () => {
    const resp = await page.request.get('/api/auth/session');
    if (!resp.ok()) return false;
    const json = (await resp.json()) as { user?: { email?: string } };
    return Boolean(json.user?.email);
  }, { timeout: 10_000 }).toBe(true);
}

test.describe('Fluxo de Primeiro Cadastro', () => {
  test.beforeEach(async () => { await resetDb(prisma); });

  test('Homepage redireciona para register quando não há usuários', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/register');
    await expect(page.getByText('Primeiro Cadastro')).toBeVisible();
    await expect(page.getByText('Crie a primeira conta de administrador')).toBeVisible();
  });

  test('Login redireciona para register quando não há usuários', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForURL('**/register');
    await expect(page.getByText('Primeiro Cadastro')).toBeVisible();
  });

  test('Fluxo completo: homepage → register → login', async ({ page }) => {
    // 1. Acessa homepage, é redirecionado para register
    await page.goto('/');
    await page.waitForURL('**/register');
    
    // 2. Faz o primeiro cadastro
    await page.fill('[data-testid="register-nome-first"]', 'Admin');
    await page.fill('[data-testid="register-nome-last"]', 'Sistema');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-email"]', 'admin@sistema.com');
    await page.fill('[data-testid="register-senha"]', 'MinhaSenh@123');
    await page.fill('[data-testid="register-senha-confirmar"]', 'MinhaSenh@123');
    await page.check('input[type="checkbox"]'); // aceitar termos
    await page.click('[data-testid="register-submit"]');
    
    // 3. Deve ser redirecionado para dashboard após criação
    await page.waitForURL('**/dashboard');
    await waitSession(page);
    
    // 4. Logout e tenta acessar homepage novamente
    await page.context().clearCookies();
    await page.goto('/');
    
    // 5. Agora deve ir para login (não register), pois já há usuários
    await page.waitForURL('**/auth/login');
    await expect(page.getByText('Bem-vindo de volta!')).toBeVisible();
    await expect(page.getByText('Solicite um convite ao administrador')).toBeVisible();
    
    // 6. Faz login com o usuário criado
    await page.fill('[data-testid="email"]', 'admin@sistema.com');
    await page.fill('[data-testid="password"]', 'MinhaSenh@123');
    await page.click('[data-testid="login-button"]');
    
    // 7. Deve ir para dashboard
    await page.waitForURL('**/dashboard');
    await waitSession(page);
  });

  test('Tentativa de acesso direto ao register após ter usuários', async ({ page }) => {
    // Cria primeiro usuário
    await page.goto('/register');
    await page.fill('[data-testid="register-nome-first"]', 'Admin');
    await page.fill('[data-testid="register-nome-last"]', 'Sistema');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-email"]', 'admin@sistema.com');
    await page.fill('[data-testid="register-senha"]', 'MinhaSenh@123');
    await page.fill('[data-testid="register-senha-confirmar"]', 'MinhaSenh@123');
    await page.check('input[type="checkbox"]');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    
    // Limpa cookies e tenta acessar register novamente
    await page.context().clearCookies();
    await page.goto('/register');
    
    // Deve ser redirecionado para login
    await page.waitForURL('**/auth/login');
    await expect(page.getByText('Bem-vindo de volta!')).toBeVisible();
  });
});