import { test, expect } from '@playwright/test';

test('login shows the access contexts, credentials, and context-aware password recovery', async ({ page }) => {
  await page.goto('/auth/login?context=owner');

  await expect(page.getByRole('heading', { name: 'Bem-vindo de volta' })).toBeVisible();
  const accessNav = page.getByRole('navigation', { name: 'Tipo de acesso' });
  await expect(accessNav.getByRole('link', { name: 'Acesso do diretor' })).toBeVisible();
  await expect(accessNav.getByRole('link', { name: 'Acesso do colaborador' })).toBeVisible();
  await expect(page.getByTestId('email')).toBeVisible();
  await expect(page.getByTestId('password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Esqueceu a senha?' })).toHaveAttribute(
    'href',
    '/auth/forgot-password?context=owner',
  );

  await accessNav.getByRole('link', { name: 'Acesso do colaborador' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?context=collaborator$/);
  await expect(page.getByRole('link', { name: 'Esqueceu a senha?' })).toHaveAttribute(
    'href',
    '/auth/forgot-password?context=collaborator',
  );
});
