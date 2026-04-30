import { test, expect } from '@playwright/test';
import prisma from '../lib/prisma';
import { resetDb } from './utils/reset-db';

test.describe('First User', () => {
  test.beforeEach(async () => {
    await resetDb(prisma);
  });

  test('Registro inicial cria ADMIN e loga', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola Primeira');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Admin Root');
    await page.fill('[data-testid="register-email"]', 'admin@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await expect(page.locator('[data-testid="dashboard-header"]')).toContainText('Admin Root');
  });

  test('Erro de email duplicado', async ({ page }) => {
    // cria primeiro
    await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola Primeira');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Admin Root');
    await page.fill('[data-testid="register-email"]', 'admin@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    // tenta de novo com mesmo email diferente conta
    await page.context().clearCookies();
    await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Outra Escola');
    await page.fill('[data-testid="register-cpfCnpj"]', '98765432100');
    await page.fill('[data-testid="register-nome"]', 'Outro Admin');
    await page.fill('[data-testid="register-email"]', 'admin@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await expect(
      page.locator('[data-testid="register-email-error"], [data-testid="register-error"]'),
    ).toContainText('E-mail já está em uso.');
  });

  test('Erro de CPF/CNPJ duplicado', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Escola Primeira');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Admin Root');
    await page.fill('[data-testid="register-email"]', 'admin@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await page.waitForURL('**/dashboard');
    await page.context().clearCookies();
    // tenta mesmo cpfCnpj com outro email
    await page.goto('/register');
    await page.fill('[data-testid="register-escolaNome"]', 'Outra Escola');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-nome"]', 'Outro Admin');
    await page.fill('[data-testid="register-email"]', 'admin2@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.click('[data-testid="register-submit"]');
    await expect(
      page.locator('[data-testid="register-cpfCnpj-error"], [data-testid="register-error"]'),
    ).toContainText('Já existe uma escola registrada com este CPF/CNPJ.');
  });
});
