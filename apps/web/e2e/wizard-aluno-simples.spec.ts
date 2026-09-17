import { test, expect } from '@playwright/test';
import { seedAdminAndAuthenticate } from './utils/auth';
import { randomUUID } from 'node:crypto';

test.describe('Wizard de Aluno - Simples', () => {
  test.beforeEach(async ({ page }) => {
    // A autenticação do cenário usa a fixture canônica; o fluxo de cadastro é
    // coberto separadamente pelos testes de onboarding.
    await seedAdminAndAuthenticate(page, { email: `wizard-${randomUUID()}@e2e.test` });

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
    await expect(page.getByRole('heading', { name: 'Gestão de Alunos' }).first()).toBeVisible();
    await expect(page.getByTestId('abrir-wizard-aluno').first()).toBeVisible();

    // Abre o wizard
    await page.getByTestId('abrir-wizard-aluno').first().click();

    // Verifica se o wizard abriu
    await expect(page.getByTestId('aluno-wizard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Identificação' })).toBeVisible();
    
    // Verifica se os campos básicos estão presentes
    await expect(page.getByTestId('aluno-nome')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Data de nascimento' })).toBeVisible();
  });
});
