import { test, expect } from '@playwright/test';

test.describe('Wizard de Aluno - Simples', () => {
  test.beforeEach(async ({ page }) => {
    // Primeiro faz registro/login para ter acesso às páginas autenticadas
    await page.goto('/register');
    await page.fill('[data-testid="register-nome-first"]', 'Admin');
    await page.fill('[data-testid="register-nome-last"]', 'E2E');
    await page.fill('[data-testid="register-cpfCnpj"]', '12345678901');
    await page.fill('[data-testid="register-email"]', 'admin-e2e@example.com');
    await page.fill('[data-testid="register-senha"]', 'SenhaFort3!');
    await page.fill('[data-testid="register-senha-confirmar"]', 'SenhaFort3!');
    await page.check('input[type="checkbox"]'); // aceitar termos
    await page.click('[data-testid="register-submit"]');
    // Aguarda redirecionamento bem-sucedido (qualquer página autenticada)
    await page.waitForTimeout(2000);

    // Intercepta GET de alunos para lista vazia inicialmente
    await page.route('**/api/alunos?**', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return;
      }
      await route.continue();
    });
  });

  test('wizard abre e mostra campos básicos', async ({ page }) => {
    await page.goto('/alunos');

    // Aguarda carregamento da página e botão estar visível
    await expect(page.getByText('Gestão de Alunos')).toBeVisible();
    await expect(page.getByTestId('abrir-wizard-aluno')).toBeVisible();

    // Abre o wizard
    await page.getByTestId('abrir-wizard-aluno').click();

    // Verifica se o wizard abriu
    await expect(page.getByTestId('aluno-wizard')).toBeVisible();
    await expect(page.getByTestId('aluno-step-label')).toHaveText('IDENTIFICAÇÃO');
    
    // Verifica se os campos básicos estão presentes
    await expect(page.getByTestId('aluno-nome')).toBeVisible();
    await expect(page.getByTestId('aluno-dataNasc')).toBeVisible();
  });
});