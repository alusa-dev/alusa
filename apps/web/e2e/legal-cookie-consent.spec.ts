import { expect, test } from '@playwright/test';

test.describe('LGPD public flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
  });

  test('registro sem convite encaminha à lista de espera', async ({ page }) => {
    await page.goto('/auth/register');

    await expect(page).toHaveURL(/\/lista-de-espera$/);
    await expect(page.getByRole('heading', { name: /lista de espera/i })).toBeVisible();
  });

  test('banner de cookies redireciona para preferencias e salva', async ({ page }) => {
    await page.goto('/privacidade');

    await expect(page.getByRole('region', { name: /Preferencias de cookies/i })).toBeVisible();
    await page.getByRole('link', { name: /gerencie os cookies/i }).click();
    await expect(page).toHaveURL(/.*preferencias-de-cookies/);
    
    await expect(page.getByRole('heading', { name: 'Configurações de cookies', level: 1 })).toBeVisible();
    
    // Clica para salvar as configurações padrões (não essenciais desativados)
    await page.getByRole('button', { name: /Salvar configurações/i }).click();
    
    await expect(page.getByRole('region', { name: /Preferencias de cookies/i })).toBeHidden();

    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('alusa.cookie-consent.v1') ?? '{}'));
    expect(stored.categories).toMatchObject({
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
  });
});
