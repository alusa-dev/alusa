import { test, expect } from '@playwright/test';

test('CRUD de Alunos', async ({ page }) => {
  await page.goto('/admin/alunos');

  await page.getByRole('button', { name: 'Novo Aluno' }).click();
  await page.getByPlaceholder('Nome').fill('Aluno E2E');
  await page.getByPlaceholder('E-mail').fill('alunoe2e@example.com');
  await page.getByPlaceholder('Telefone').fill('(11) 99999-8888');
  await page.getByPlaceholder('Data de Nascimento').fill('2000-01-01');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByText('Aluno E2E')).toBeVisible();

  await page.getByRole('button', { name: 'Editar' }).first().click();
  await page.getByPlaceholder('Nome').fill('Aluno E2E Editado');
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByText('Aluno E2E Editado')).toBeVisible();

  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Excluir' }).first().click();
});
